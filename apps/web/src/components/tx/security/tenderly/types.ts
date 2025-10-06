// Tenderly simulation types
export interface StateObject {
  balance?: string
  nonce?: number
  code?: string
  storage?: Record<string, string>
}

export interface ContractCall {
  address: string
  value?: string
  input: string
  caller?: string
}

export interface TransactionSimulation {
  simulation?: {
    id: string
    status: boolean
    gas_used: number
    call_trace?: any
    shared: boolean
    error?: string
  }
  transaction?: ContractCall
  contracts?: StateObject[]
}

export interface TenderlySimulatePayload {
  network_id: string
  from: string
  to: string
  input: string
  gas?: number
  gas_price?: string
  value?: string
  simulation_type?: 'full' | 'tracer' | 'quick'
  block_number?: string
  transaction_index?: number
}

export interface TenderlySimulation extends TransactionSimulation {
  id?: string
  status?: boolean
}
