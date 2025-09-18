package xyz.chatboxapp.ce.data.model

import android.os.Parcelable
import kotlinx.parcelize.Parcelize

@Parcelize
data class AIModel(
    val modelId: String,
    val nickname: String?,
    val provider: String,
    val capabilities: List<String>,
    val contextWindow: Int,
    val pricing: Pricing,
    val description: String
) : Parcelable {
    
    @Parcelize
    data class Pricing(
        val input: Double,
        val output: Double
    ) : Parcelable
    
    fun getDisplayName(): String {
        return nickname ?: modelId
    }
    
    fun hasCapability(capability: String): Boolean {
        return capabilities.contains(capability)
    }
    
    fun getCapabilityIcons(): List<String> {
        return capabilities.map { capability ->
            when (capability) {
                "vision" -> "👁️"
                "tool_use" -> "🔧"
                "reasoning" -> "🧠"
                "code" -> "💻"
                "image_generation" -> "🎨"
                "multimodal" -> "🎭"
                else -> "💬"
            }
        }
    }
}