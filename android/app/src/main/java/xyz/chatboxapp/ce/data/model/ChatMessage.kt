package xyz.chatboxapp.ce.data.model

import android.os.Parcelable
import kotlinx.parcelize.Parcelize

@Parcelize
data class ChatMessage(
    val id: String,
    val content: String,
    val type: MessageType,
    val timestamp: Long,
    val modelId: String? = null,
    val capabilities: List<String>? = null
) : Parcelable {
    
    enum class MessageType {
        USER,
        ASSISTANT,
        SYSTEM,
        ERROR
    }
    
    companion object {
        fun createUserMessage(content: String): ChatMessage {
            return ChatMessage(
                id = System.currentTimeMillis().toString(),
                content = content,
                type = MessageType.USER,
                timestamp = System.currentTimeMillis()
            )
        }
        
        fun createAssistantMessage(
            content: String,
            modelId: String? = null,
            capabilities: List<String>? = null
        ): ChatMessage {
            return ChatMessage(
                id = System.currentTimeMillis().toString(),
                content = content,
                type = MessageType.ASSISTANT,
                timestamp = System.currentTimeMillis(),
                modelId = modelId,
                capabilities = capabilities
            )
        }
        
        fun createErrorMessage(content: String): ChatMessage {
            return ChatMessage(
                id = System.currentTimeMillis().toString(),
                content = content,
                type = MessageType.ERROR,
                timestamp = System.currentTimeMillis()
            )
        }
    }
}