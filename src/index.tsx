import React from 'react'
import ReactDOM from 'react-dom'
import { HashRouter as Router } from 'react-router-dom'
import { PersistGate } from 'redux-persist/integration/react'

import './index.css'

import App from './App'
import configureStore from './store'
import { Provider } from 'react-redux'
import { LoadingOutlined } from '@ant-design/icons'
import { QueryClient, QueryClientProvider } from 'react-query'
import { SolanaWeb3Provider } from '@/contexts/solana-web3'
import { SolanaConnectionConfigProvider } from './contexts/solana-connection-config'

const { store, persistor } = configureStore()

const queryClient = new QueryClient()

ReactDOM.render(
  <Provider store={store}>
    <PersistGate loading={<LoadingOutlined />} persistor={persistor}>
      <Router>
        <QueryClientProvider client={queryClient}>
          <SolanaConnectionConfigProvider>
            <SolanaWeb3Provider>
              <App />
            </SolanaWeb3Provider>
          </SolanaConnectionConfigProvider>
        </QueryClientProvider>
      </Router>
    </PersistGate>
  </Provider>,
  document.getElementById('root')
)
