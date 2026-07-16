'use client'

import { useEffect } from 'react'

export default function DocPage() {
  useEffect(() => {
    // 重定向到静态HTML文档
    window.location.href = '/doc.html'
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">正在跳转到项目文档...</p>
      </div>
    </div>
  )
}