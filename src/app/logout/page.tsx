'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'

export default function LogoutPage() {
  const router = useRouter()

  useEffect(() => {
    // Clear any stored authentication data
    if (typeof window !== 'undefined') {
      localStorage.clear()
      sessionStorage.clear()
    }
    
    // Redirect to home page after a short delay
    const timer = setTimeout(() => {
      router.push('/')
    }, 2000)

    return () => clearTimeout(timer)
  }, [router])

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-lg p-8 max-w-md mx-auto text-center">
        <LogOut className="h-16 w-16 text-blue-500 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Logged Out</h2>
        <p className="text-gray-600 mb-4">
          You have been successfully logged out.
        </p>
        <p className="text-sm text-gray-500">
          Redirecting to home page...
        </p>
      </div>
    </div>
  )
}