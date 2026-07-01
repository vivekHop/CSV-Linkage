import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ReactFlowProvider } from 'reactflow'
import { CustomDialogProvider } from './components/CustomDialog'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ReactFlowProvider>
      <CustomDialogProvider>
        <App />
      </CustomDialogProvider>
    </ReactFlowProvider>
  </StrictMode>,
)

