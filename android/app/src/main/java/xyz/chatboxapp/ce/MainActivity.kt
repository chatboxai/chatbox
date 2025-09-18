package xyz.chatboxapp.ce

import android.content.Intent
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.ViewModelProvider
import androidx.recyclerview.widget.LinearLayoutManager
import xyz.chatboxapp.ce.databinding.ActivityMainBinding
import xyz.chatboxapp.ce.ui.adapter.AIModelAdapter
import xyz.chatboxapp.ce.ui.viewmodel.MainViewModel
import xyz.chatboxapp.ce.utils.AIProviderManager

class MainActivity : AppCompatActivity() {
    
    private lateinit var binding: ActivityMainBinding
    private lateinit var viewModel: MainViewModel
    private lateinit var aiModelAdapter: AIModelAdapter
    private lateinit var aiProviderManager: AIProviderManager
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        
        setupToolbar()
        setupViewModel()
        setupRecyclerView()
        setupClickListeners()
        setupAIProvider()
        
        viewModel.loadAIModels()
    }
    
    private fun setupToolbar() {
        setSupportActionBar(binding.toolbar)
        supportActionBar?.title = "Chatbox AI"
    }
    
    private fun setupViewModel() {
        viewModel = ViewModelProvider(this)[MainViewModel::class.java]
        
        viewModel.aiModels.observe(this) { models ->
            aiModelAdapter.submitList(models)
        }
        
        viewModel.isLoading.observe(this) { isLoading ->
            binding.progressBar.visibility = if (isLoading) android.view.View.VISIBLE else android.view.View.GONE
        }
        
        viewModel.error.observe(this) { error ->
            if (error != null) {
                // Show error message
                binding.errorText.text = error
                binding.errorText.visibility = android.view.View.VISIBLE
            } else {
                binding.errorText.visibility = android.view.View.GONE
            }
        }
    }
    
    private fun setupRecyclerView() {
        aiModelAdapter = AIModelAdapter { model ->
            // Open chat with selected model
            val intent = Intent(this, ChatActivity::class.java)
            intent.putExtra("model_id", model.modelId)
            intent.putExtra("model_name", model.nickname ?: model.modelId)
            startActivity(intent)
        }
        
        binding.recyclerView.apply {
            layoutManager = LinearLayoutManager(this@MainActivity)
            adapter = aiModelAdapter
        }
    }
    
    private fun setupClickListeners() {
        binding.fab.setOnClickListener {
            // Open settings
            val intent = Intent(this, SettingsActivity::class.java)
            startActivity(intent)
        }
        
        binding.refreshButton.setOnClickListener {
            viewModel.loadAIModels()
        }
    }
    
    private fun setupAIProvider() {
        aiProviderManager = AIProviderManager(this)
        
        // Initialize with default models
        aiProviderManager.initializeWithDefaultModels()
    }
    
    override fun onCreateOptionsMenu(menu: Menu?): Boolean {
        menuInflater.inflate(R.menu.main_menu, menu)
        return true
    }
    
    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        return when (item.itemId) {
            R.id.action_settings -> {
                val intent = Intent(this, SettingsActivity::class.java)
                startActivity(intent)
                true
            }
            R.id.action_about -> {
                // Show about dialog
                true
            }
            else -> super.onOptionsItemSelected(item)
        }
    }
    
    override fun onResume() {
        super.onResume()
        // Refresh models when returning to activity
        viewModel.loadAIModels()
    }
}