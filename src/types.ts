export type Table = 'categories' | 'products' | 'lists' | 'list_items' | 'price_history'
export const TABLES: Table[] = ['categories', 'products', 'lists', 'list_items', 'price_history']

export interface Base { id: string; household_id: string; updated_at: string; deleted: boolean; synced_at?: string }
export interface Category extends Base { name: string; color: string; sort: number }
export interface Product extends Base { name: string; category: string; unit: string; price: number | null }
export interface List extends Base { name: string; status: 'active' | 'archived'; created_at: string; archived_at: string | null }
export interface ListItem extends Base {
  list_id: string; product_id: string | null; name: string; category: string
  qty: number; unit: string; est_price: number | null; paid_price: number | null; checked: boolean; sort: number
}
export interface PriceHistory extends Base { product_id: string | null; product_name: string; price: number; kind: 'pago' | 'estimado' | 'oficial'; at: string }

export type RowOf<T extends Table> = T extends 'categories' ? Category : T extends 'products' ? Product
  : T extends 'lists' ? List : T extends 'list_items' ? ListItem : PriceHistory
export type AnyRow = Category | Product | List | ListItem | PriceHistory

export interface Session { userId: string; email: string }
export interface Household { id: string; name: string; invite_code: string }

export interface Remote {
  getSession(): Promise<Session | null>
  signIn(email: string, password: string): Promise<Session>
  signUp(email: string, password: string): Promise<Session | null>
  signOut(): Promise<void>
  myHousehold(): Promise<Household | null>
  createHousehold(name: string): Promise<Household>
  joinHousehold(code: string): Promise<Household>
  pull(table: Table, household: string, since: string | null): Promise<AnyRow[]>
  push(table: Table, rows: AnyRow[]): Promise<void>
  subscribe(household: string, onChange: () => void): () => void
}
