package xyz.chatboxapp.ce

import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import xyz.chatboxapp.ce.databinding.ActivitySettingsBinding
import xyz.chatboxapp.ce.utils.AIProviderManager

class SettingsActivity : AppCompatActivity() {
    
    private lateinit var binding: ActivitySettingsBinding
    private lateinit var aiProviderManager: AIProviderManager
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(binding.root)
        
        setupToolbar()
        setupAIProvider()
        setupClickListeners()
        loadCurrentApiKey()
    }
    
    private fun setupToolbar() {
        setSupportActionBar(binding.toolbar)
        supportActionBar?.title = "Settings"
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
    }
    
    private fun setupAIProvider() {
        aiProviderManager = AIProviderManager(this)
    }
    
    private fun setupClickListeners() {
        binding.saveButton.setOnClickListener {
            saveApiKey()
        }
        
        binding.validateButton.setOnClickListener {
            validateApiKey()
        }
    }
    
    private fun loadCurrentApiKey() {
        val currentApiKey = aiProviderManager.getApiKey()
        if (currentApiKey != null) {
            binding.apiKeyInput.setText(currentApiKey)
        }
    }
    
    private fun saveApiKey() {
        val apiKey = binding.apiKeyInput.text.toString().trim()
        
        if (apiKey.isEmpty()) {
            Toast.makeText(this, "Please enter an API key", Toast.LENGTH_SHORT).show()
            return
        }
        
        aiProviderManager.setApiKey(apiKey)
        Toast.makeText(this, "API key saved successfully", Toast.LENGTH_SHORT).show()
        
        // Return to main activity
        val intent = Intent(this, MainActivity::class.java)
        intent.flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK
        startActivity(intent)
        finish()
    }
    
    private fun validateApiKey() {
        val apiKey = binding.apiKeyInput.text.toString().trim()
        
        if (apiKey.isEmpty()) {
            Toast.makeText(this, "Please enter an API key", Toast.LENGTH_SHORT).show()
            return
        }
        
        binding.validateButton.isEnabled = false
        binding.validateButton.text = "Validating..."
        
        lifecycleScope.launch {
            try {
                val isValid = aiProviderManager.validateApiKey(apiKey)
                if (isValid) {
                    Toast.makeText(this@SettingsActivity, "API key is valid", Toast.LENGTH_SHORT).show()
                } else {
                    Toast.makeText(this@SettingsActivity, "Invalid API key", Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) {
                Toast.makeText(this@SettingsActivity, "Error validating API key: ${e.message}", Toast.LENGTH_LONG).show()
            } finally {
                binding.validateButton.isEnabled = true
                binding.validateButton.text = "Validate API Key"
            }
        }
    }
    
    override fun onSupportNavigateUp(): Boolean {
        onBackPressed()
        return true
    }
}