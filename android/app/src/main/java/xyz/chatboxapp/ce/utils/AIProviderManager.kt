package xyz.chatboxapp.ce.utils

import android.content.Context
import android.content.SharedPreferences
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import xyz.chatboxapp.ce.data.model.AIModel
import xyz.chatboxapp.ce.network.OpenRouterAPI
import xyz.chatboxapp.ce.network.RetrofitClient

class AIProviderManager(private val context: Context) {
    
    private val prefs: SharedPreferences = context.getSharedPreferences("ai_provider", Context.MODE_PRIVATE)
    private val gson = Gson()
    private val api: OpenRouterAPI = RetrofitClient.create()
    
    companion object {
        private const val PREF_API_KEY = "openrouter_api_key"
        private const val PREF_MODELS = "cached_models"
        private const val PREF_LAST_UPDATE = "last_model_update"
    }
    
    fun setApiKey(apiKey: String) {
        prefs.edit().putString(PREF_API_KEY, apiKey).apply()
    }
    
    fun getApiKey(): String? {
        return prefs.getString(PREF_API_KEY, null)
    }
    
    fun hasApiKey(): Boolean {
        return getApiKey() != null && getApiKey()!!.isNotEmpty()
    }
    
    suspend fun validateApiKey(apiKey: String): Boolean {
        return try {
            val response = api.validateApiKey(apiKey)
            response.isSuccessful
        } catch (e: Exception) {
            false
        }
    }
    
    suspend fun fetchModels(): List<AIModel> {
        return try {
            val apiKey = getApiKey()
            if (apiKey == null) {
                return getDefaultModels()
            }
            
            val response = api.getModels(apiKey)
            if (response.isSuccessful) {
                val models = response.body()?.data?.map { modelData ->
                    AIModel(
                        modelId = modelData.id,
                        nickname = modelData.name,
                        provider = modelData.provider?.name ?: "Unknown",
                        capabilities = extractCapabilities(modelData.id),
                        contextWindow = modelData.context_length,
                        pricing = AIModel.Pricing(
                            input = modelData.pricing?.prompt ?: 0.0,
                            output = modelData.pricing?.completion ?: 0.0
                        ),
                        description = modelData.description ?: ""
                    )
                } ?: emptyList()
                
                // Cache models
                cacheModels(models)
                models
            } else {
                getCachedModels() ?: getDefaultModels()
            }
        } catch (e: Exception) {
            getCachedModels() ?: getDefaultModels()
        }
    }
    
    private fun extractCapabilities(modelId: String): List<String> {
        val capabilities = mutableListOf<String>()
        
        when {
            modelId.contains("gpt-4") || modelId.contains("claude-3") || modelId.contains("gemini-pro") -> {
                capabilities.addAll(listOf("reasoning", "tool_use", "vision"))
            }
            modelId.contains("dall-e") || modelId.contains("midjourney") -> {
                capabilities.add("image_generation")
            }
            modelId.contains("code") -> {
                capabilities.add("code")
            }
            else -> {
                capabilities.add("text")
            }
        }
        
        return capabilities
    }
    
    private fun cacheModels(models: List<AIModel>) {
        val modelsJson = gson.toJson(models)
        prefs.edit()
            .putString(PREF_MODELS, modelsJson)
            .putLong(PREF_LAST_UPDATE, System.currentTimeMillis())
            .apply()
    }
    
    private fun getCachedModels(): List<AIModel>? {
        val modelsJson = prefs.getString(PREF_MODELS, null) ?: return null
        val lastUpdate = prefs.getLong(PREF_LAST_UPDATE, 0)
        
        // Return cached models if they're less than 1 hour old
        if (System.currentTimeMillis() - lastUpdate < 3600000) {
            val type = object : TypeToken<List<AIModel>>() {}.type
            return gson.fromJson(modelsJson, type)
        }
        
        return null
    }
    
    fun getDefaultModels(): List<AIModel> {
        return listOf(
            AIModel(
                modelId = "openai/gpt-4o",
                nickname = "GPT-4o",
                provider = "OpenAI",
                capabilities = listOf("reasoning", "tool_use", "vision"),
                contextWindow = 128000,
                pricing = AIModel.Pricing(0.005, 0.015),
                description = "Most advanced GPT-4 model with vision capabilities"
            ),
            AIModel(
                modelId = "anthropic/claude-3.5-sonnet",
                nickname = "Claude 3.5 Sonnet",
                provider = "Anthropic",
                capabilities = listOf("reasoning", "tool_use", "vision"),
                contextWindow = 200000,
                pricing = AIModel.Pricing(0.003, 0.015),
                description = "Most capable Claude model with excellent reasoning"
            ),
            AIModel(
                modelId = "google/gemini-pro-1.5",
                nickname = "Gemini Pro 1.5",
                provider = "Google",
                capabilities = listOf("reasoning", "tool_use", "vision"),
                contextWindow = 2000000,
                pricing = AIModel.Pricing(0.000375, 0.0015),
                description = "Google's most advanced model with massive context"
            ),
            AIModel(
                modelId = "meta-llama/llama-3.1-70b-instruct",
                nickname = "Llama 3.1 70B",
                provider = "Meta",
                capabilities = listOf("reasoning", "tool_use"),
                contextWindow = 128000,
                pricing = AIModel.Pricing(0.0009, 0.0009),
                description = "Meta's most capable open-source model"
            ),
            AIModel(
                modelId = "openai/dall-e-3",
                nickname = "DALL-E 3",
                provider = "OpenAI",
                capabilities = listOf("image_generation"),
                contextWindow = 0,
                pricing = AIModel.Pricing(0.04, 0.0),
                description = "Latest image generation model"
            )
        )
    }
    
    fun initializeWithDefaultModels() {
        if (!hasApiKey()) {
            // Initialize with default models if no API key
            cacheModels(getDefaultModels())
        }
    }
    
    suspend fun sendMessage(modelId: String, message: String): String {
        val apiKey = getApiKey() ?: throw Exception("API key not set")
        
        return try {
            val response = api.sendMessage(apiKey, modelId, message)
            if (response.isSuccessful) {
                response.body()?.choices?.firstOrNull()?.message?.content ?: "No response received"
            } else {
                throw Exception("API request failed: ${response.code()}")
            }
        } catch (e: Exception) {
            throw Exception("Failed to send message: ${e.message}")
        }
    }
}