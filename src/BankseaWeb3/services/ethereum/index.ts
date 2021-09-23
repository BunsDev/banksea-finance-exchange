import { getUriByIpfsHash, pinJsonToIPFS } from '@/utils/ipfs'
import { bankseaWeb3 } from '@/BankseaWeb3'
import { NFTCreateForm } from '@/pages/Home/NFTCreate'
import { generateNftMetadata } from '@/utils'
import { BankseaWeb3Services, PurchaseByFixedPriceParams } from '../index'
import SimpleEventEmitter from '@/utils/SimpleEventEmitter'
import { CreateNftEvents } from '../events'
import { createNFT, NftCreateForm } from '@/apis/nft'
import { ExchangeOrder, ExchangeOrderAsset, SellingOrder } from '../../contracts/ethereum/services/exchange/types'
import { hashExchangeOrder, hashExchangeOrderAsset } from '../../contracts/ethereum/services/exchange/utils'
import { ethers } from 'ethers'
import { completeOrder, createSellOrder, findOrder } from '@/apis/exchange/ethereum'
import { toBigNumber, toWei, web3Utils, weiToBigNumber } from '@/web3/utils'
import { NftDetail } from '@/types/NFTDetail'
import { TransactionReceipt, TransactionResponse } from '@/BankseaWeb3/contracts/ethereum/contracts/type'

export class BankseaWeb3EthereumServicesImpl implements BankseaWeb3Services {

  createNft(nftCreateForm: NFTCreateForm, account: string): SimpleEventEmitter<CreateNftEvents> {
    const ee = new SimpleEventEmitter<CreateNftEvents>()

    ee.task = async () => {

      const nftMetadata = generateNftMetadata(nftCreateForm)

      ee.emit('pinning_json')

      const pinResult = await pinJsonToIPFS(nftMetadata).catch(e => {
        const error = e.response?.data?.error ?? e?.toString() ?? 'unknown error'
        ee.emit('json_pinned_failed', error)
      })

      if (!pinResult) {
        return
      }

      ee.emit('json_pinned')

      const { IpfsHash } = pinResult

      const tokenUri = getUriByIpfsHash(IpfsHash)

      const createForm: NftCreateForm = {
        uri: IpfsHash,
        addressCreate: account!,
        tokenId: '',
        group: '',
        nameArtist: nftCreateForm.artistName,
        fee: '',
        feeRecipient: '',
        typeChain: 'Ethereum'
      }

      bankseaWeb3.eth.Banksea.awardItem(account!, tokenUri)
        .then((response: TransactionResponse) => {
          response.wait().then(async (receipt: TransactionReceipt) => {
            const [, , , tokenId] = receipt.logs[0].topics

            await createNFT({ ...createForm, tokenId: web3Utils.hexToNumberString(tokenId) })
            ee.emit('complete')
          })
          ee.emit('submitted')
        })
        .catch(e => {
          ee.emit('wallet_error', e)
        })
    }

    return ee
  }

  async listByFixedPrice(nftDetail: NftDetail, price: string, account?: string) {

    if (!account) {
      throw new Error('Account must be not null!')
    }

    if (!await bankseaWeb3.eth.Banksea.isApprovedForAll(account, '0xa0d0d425715C735f950dFED41876AAF626a0A4b5')) {
      await bankseaWeb3.eth.Banksea.setApprovalForAll('0xa0d0d425715C735f950dFED41876AAF626a0A4b5', true)
    }

    const salt = (Date.parse(new Date().toString())) / 1000

    const makerAsset: ExchangeOrderAsset = {
      settleType: 0,
      baseAsset: {
        code: {
          baseType: 3,
          extraType: nftDetail?.tokenId,
          contractAddr: bankseaWeb3.eth.Banksea.contract!.address
        },
        value: 1
      },
      extraValue: 0
    }

    const takerAsset: ExchangeOrderAsset = {
      settleType: 0,
      baseAsset: {
        code: {
          baseType: 1,
          extraType: 0,
          contractAddr: '0x0000000000000000000000000000000000000000'
        },
        value: toWei(price)
      },
      extraValue: 0
    }

    const order: ExchangeOrder = {
      dir: 0,
      maker: account!,
      makerAssetHash: hashExchangeOrderAsset(makerAsset),
      taker: '0x0000000000000000000000000000000000000000',
      takerAssetHash: hashExchangeOrderAsset(takerAsset),
      fee: 0,
      feeRecipient: '0x0000000000000000000000000000000000000000',
      startTime: 0,
      endTime: 0,
      salt
    }

    const signature = await bankseaWeb3.signer!.signMessage(ethers.utils.arrayify(hashExchangeOrder(order)))

    const sellingOrder: SellingOrder = {
      dir: 'sell',
      maker: account,
      makerAssetSettleType: 0,
      makerAssetBaseType: 3,
      makerAssetExtraType: nftDetail!.tokenId,
      makerAssetContractAddr: nftDetail!.addressContract,
      makerAssetValue: price,
      makerAssetExtraValue: 0,
      fee: 0,
      feeRecipient: 0,
      startTime: 0,
      endTime: 0,
      valueUri: nftDetail!.valueUri,
      signature,
      salt
    }

    await createSellOrder(sellingOrder)
  }

  async checkBalance(nftDetail: any): Promise<void> {
    const balance = weiToBigNumber((await bankseaWeb3.signer?.getBalance())?.toString())

    if (balance.gte(toBigNumber(nftDetail.price))) {
      return Promise.resolve()
    } else {
      return Promise.reject('Insufficient balance')
    }
  }

  async purchaseByFixedPrice({ nftDetail, account, onAuthorized, onSuccess }: PurchaseByFixedPriceParams) {
    const buyData = (await findOrder({
      valueUri: nftDetail?.valueUri
    })).data.data

    const price = toWei(buyData!.makerAsset!.baseAsset!.value)

    const sellOrder: ExchangeOrder = {
      dir: 0,
      maker: nftDetail!.addressOwner,
      makerAsset: {
        settleType: 0,
        baseAsset: {
          code: {
            baseType: 3,
            extraType: nftDetail!.tokenId,
            contractAddr: bankseaWeb3.eth.Banksea.contract!.address
          },
          value: 1
        },
        extraValue: 0
      },
      taker: '0x0000000000000000000000000000000000000000',
      takerAsset: {
        settleType: 0,
        baseAsset: {
          code: {
            baseType: 1,
            extraType: 0,
            contractAddr: '0x0000000000000000000000000000000000000000'
          },
          value: price
        },
        extraValue: 0
      },
      fee: 0,
      feeRecipient: '0x0000000000000000000000000000000000000000',
      startTime: 0,
      endTime: 0,
      salt: buyData?.salt
    }

    const makerAsset: ExchangeOrderAsset = {
      settleType: 0,
      baseAsset: {
        code: {
          baseType: 1,
          extraType: 0,
          contractAddr: '0x0000000000000000000000000000000000000000'
        },
        value: price
      },
      extraValue: 0
    }

    const takerAsset: ExchangeOrderAsset = {
      settleType: 0,
      baseAsset: {
        code: {
          baseType: 3,
          extraType: nftDetail?.tokenId,
          contractAddr: bankseaWeb3.eth.Banksea.contract!.address
        },
        value: 1
      },
      extraValue: 0
    }

    const buyOrder: ExchangeOrder = {
      dir: 1,
      maker: account!,
      makerAsset,
      makerAssetHash: hashExchangeOrderAsset(makerAsset),
      taker: nftDetail!.addressOwner,
      takerAsset,
      takerAssetHash: hashExchangeOrderAsset(takerAsset),
      fee: 0,
      feeRecipient: '0x0000000000000000000000000000000000000000',
      startTime: 0,
      endTime: 0,
      salt: (Date.parse(new Date().toString())) / 1000
    }

    const signature = await bankseaWeb3.signer!.signMessage(ethers.utils.arrayify(hashExchangeOrder(buyOrder)))
    onAuthorized()

    await bankseaWeb3.eth.Exchange.matchSingle(sellOrder, buyData!.signature, buyOrder, signature, `${makerAsset!.baseAsset.value}`)

    await completeOrder({
      valueUri: nftDetail?.valueUri,
      addressOwner: account!
    })

    onSuccess()
  }
}
