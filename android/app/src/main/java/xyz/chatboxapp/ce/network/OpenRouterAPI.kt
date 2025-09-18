package xyz.chatboxapp.ce.network

import retrofit2.Response
import retrofit2.http.*

interface OpenRouterAPI {
    
    @GET("models")
    suspend fun getModels(
        @Header("Authorization") apiKey: String,
        @Header("HTTP-Referer") referer: String = "https://chatbox.ai",
        @Header("X-Title") title: String = "Chatbox AI"
    ): Response<ModelsResponse>
    
    @POST("chat/completions")
    suspend fun sendMessage(
        @Header("Authorization") apiKey: String,
        @Header("HTTP-Referer") referer: String = "https://chatbox.ai",
        @Header("X-Title") title: String = "Chatbox AI",
        @Body request: ChatRequest
    ): Response<ChatResponse>
    
    @GET("auth/key")
    suspend fun validateApiKey(
        @Header("Authorization") apiKey: String,
        @Header("HTTP-Referer") referer: String = "https://chatbox.ai",
        @Header("X-Title") title: String = "Chatbox AI"
    ): Response<AuthResponse>
}

data class ModelsResponse(
    val data: List<ModelData>
)

data class ModelData(
    val id: String,
    val name: String,
    val description: String?,
    val context_length: Int,
    val pricing: Pricing?,
    val provider: Provider?
)

data class Pricing(
    val prompt: Double,
    val completion: Double
)

data class Provider(
    val id: String,
    val name: String
)

data class ChatRequest(
    val model: String,
    val messages: List<Message>,
    val temperature: Double = 0.7,
    val max_tokens: Int = 4000,
    val stream: Boolean = false
)

data class Message(
    val role: String,
    val content: String
)

data class ChatResponse(
    val choices: List<Choice>
)

data class Choice(
    val message: Message
)

data class AuthResponse(
    val data: AuthData
)

data class AuthData(
    val credits: Double,
    val usage: Map<String, Any>,
    val limits: Map<String, Any>
)