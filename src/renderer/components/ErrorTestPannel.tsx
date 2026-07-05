import React, { useState } from 'react'

// 组件内部的错误测试工具
export function ErrorTestPanel() {
  const [shouldError, setShouldError] = useState(false)

  if (shouldError) {
    // 模拟常见的 "cannot read properties of undefined" 错误
    const obj: any = null
    return <div>{obj.nonExistentProperty.anotherProperty}</div>
  }

  const testGlobalError = () => {
    setTimeout(() => {
      throw new Error('Test global error handler - this error is intentional')
    }, 100)
  }

  const testUnhandledPromise = () => {
    // biome-ignore lint/nursery/noFloatingPromises: this dev panel button exists to fire a real unhandled rejection
    Promise.reject(new Error('Test unhandled promise rejection - this error is intentional'))
  }

  const testConsoleError = () => {
    console.error('Test console error: cannot read properties of undefined (testing)')
  }

  return (
    <div className="p-4 border rounded-lg bg-gray-50 dark:bg-gray-800">
      <h3 className="text-lg font-semibold mb-3 text-gray-900 dark:text-white">🧪 Error Testing Panel</h3>
      <div className="space-y-2">
        <button
          onClick={() => setShouldError(true)}
          className="block w-full px-3 py-2 bg-red-500 text-white rounded hover:bg-red-600"
        >
          Test React Error Boundary
        </button>
        <button
          onClick={testGlobalError}
          className="block w-full px-3 py-2 bg-orange-500 text-white rounded hover:bg-orange-600"
        >
          Test Global Error Handler
        </button>
        <button
          onClick={testUnhandledPromise}
          className="block w-full px-3 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600"
        >
          Test Unhandled Promise
        </button>
        <button
          onClick={testConsoleError}
          className="block w-full px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Test Console Error
        </button>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400 mt-3">
        ⚠️ These buttons will trigger intentional errors for testing purposes.
      </p>
    </div>
  )
}
