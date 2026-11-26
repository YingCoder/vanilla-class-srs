import { createContext, useContext } from 'react'

export interface AuthUser {
  sub: string
  username: string | null
  email: string | null
  name: string
  role: 'ADMIN' | 'TEACHER' | 'STUDENT'
  mustChangePassword: boolean
}

export interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  login: (identifier: string, password: string) => Promise<AuthUser>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  login: async () => { throw new Error('AuthProvider missing') },
  logout: async () => {},
  refresh: async () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}
