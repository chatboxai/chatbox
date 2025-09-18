package xyz.chatboxapp.ce.ui.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import xyz.chatboxapp.ce.data.model.ChatMessage
import xyz.chatboxapp.ce.utils.AIProviderManager

class ChatViewModel(application: Application) : AndroidViewModel(application) {
    
    private val aiProviderManager = AIProviderManager(application)
    
    private val _messages = MutableLiveData<List<ChatMessage>>()
    val messages: LiveData<List<ChatMessage>> = _messages
    
    private val _isLoading = MutableLiveData<Boolean>()
    val isLoading: LiveData<Boolean> = _isLoading
    
    private val _error = MutableLiveData<String?>()
    val error: LiveData<String?> = _error
    
    private var currentModelId: String = ""
    private val messageList = mutableListOf<ChatMessage>()
    
    fun initializeWithModel(modelId: String) {
        currentModelId = modelId
        _messages.value = emptyList()
        messageList.clear()
    }
    
    fun sendMessage(content: String) {
        if (content.trim().isEmpty()) return
        
        // Add user message
        val userMessage = ChatMessage.createUserMessage(content)
        messageList.add(userMessage)
        _messages.value = messageList.toList()
        
        // Send to AI
        viewModelScope.launch {
            try {
                _isLoading.value = true
                _error.value = null
                
                val response = aiProviderManager.sendMessage(currentModelId, content)
                
                // Add assistant message
                val assistantMessage = ChatMessage.createAssistantMessage(
                    content = response,
                    modelId = currentModelId
                )
                messageList.add(assistantMessage)
                _messages.value = messageList.toList()
                
            } catch (e: Exception) {
                val errorMessage = ChatMessage.createErrorMessage(
                    content = e.message ?: "Failed to send message"
                )
                messageList.add(errorMessage)
                _messages.value = messageList.toList()
                _error.value = e.message
            } finally {
                _isLoading.value = false
            }
        }
    }
    
    fun clearChat() {
        messageList.clear()
        _messages.value = emptyList()
    }
    
    fun exportChat() {
        // TODO: Implement chat export functionality
    }
}