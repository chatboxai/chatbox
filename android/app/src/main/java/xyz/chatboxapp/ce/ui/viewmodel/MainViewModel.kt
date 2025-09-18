package xyz.chatboxapp.ce.ui.viewmodel

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import xyz.chatboxapp.ce.data.model.AIModel
import xyz.chatboxapp.ce.utils.AIProviderManager

class MainViewModel(application: Application) : AndroidViewModel(application) {
    
    private val aiProviderManager = AIProviderManager(application)
    
    private val _aiModels = MutableLiveData<List<AIModel>>()
    val aiModels: LiveData<List<AIModel>> = _aiModels
    
    private val _isLoading = MutableLiveData<Boolean>()
    val isLoading: LiveData<Boolean> = _isLoading
    
    private val _error = MutableLiveData<String?>()
    val error: LiveData<String?> = _error
    
    init {
        loadAIModels()
    }
    
    fun loadAIModels() {
        viewModelScope.launch {
            try {
                _isLoading.value = true
                _error.value = null
                
                val models = aiProviderManager.fetchModels()
                _aiModels.value = models
            } catch (e: Exception) {
                _error.value = e.message ?: "Failed to load AI models"
            } finally {
                _isLoading.value = false
            }
        }
    }
    
    fun refreshModels() {
        loadAIModels()
    }
}