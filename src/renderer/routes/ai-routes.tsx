import React from 'react'
import { Routes, Route } from 'react-router-dom'
import { AIDashboardPage } from '../pages/ai-dashboard-page'
import { AIProviderDashboard } from '../components/ai-provider-dashboard'
import { AIChatInterface } from '../components/ai-chat-interface'

export const AIRoutes: React.FC = () => {
  return (
    <Routes>
      <Route path="/ai" element={<AIDashboardPage />} />
      <Route path="/ai/dashboard" element={<AIProviderDashboard />} />
      <Route path="/ai/chat" element={<AIChatInterface />} />
    </Routes>
  )
}

export default AIRoutes