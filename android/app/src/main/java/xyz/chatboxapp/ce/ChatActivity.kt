package xyz.chatboxapp.ce

import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.ViewModelProvider
import androidx.recyclerview.widget.LinearLayoutManager
import xyz.chatboxapp.ce.databinding.ActivityChatBinding
import xyz.chatboxapp.ce.ui.adapter.ChatMessageAdapter
import xyz.chatboxapp.ce.ui.viewmodel.ChatViewModel
import xyz.chatboxapp.ce.data.model.ChatMessage
import xyz.chatboxapp.ce.data.model.MessageType

class ChatActivity : AppCompatActivity() {
    
    private lateinit var binding: ActivityChatBinding
    private lateinit var viewModel: ChatViewModel
    private lateinit var chatAdapter: ChatMessageAdapter
    private var modelId: String = ""
    private var modelName: String = ""
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityChatBinding.inflate(layoutInflater)
        setContentView(binding.root)
        
        getIntentData()
        setupToolbar()
        setupViewModel()
        setupRecyclerView()
        setupClickListeners()
    }
    
    private fun getIntentData() {
        modelId = intent.getStringExtra("model_id") ?: ""
        modelName = intent.getStringExtra("model_name") ?: "AI Model"
    }
    
    private fun setupToolbar() {
        setSupportActionBar(binding.toolbar)
        supportActionBar?.title = modelName
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
    }
    
    private fun setupViewModel() {
        viewModel = ViewModelProvider(this)[ChatViewModel::class.java]
        
        viewModel.messages.observe(this) { messages ->
            chatAdapter.submitList(messages)
            if (messages.isNotEmpty()) {
                binding.recyclerView.scrollToPosition(messages.size - 1)
            }
        }
        
        viewModel.isLoading.observe(this) { isLoading ->
            binding.progressBar.visibility = if (isLoading) android.view.View.VISIBLE else android.view.View.GONE
            binding.sendButton.isEnabled = !isLoading
        }
        
        viewModel.error.observe(this) { error ->
            if (error != null) {
                Toast.makeText(this, error, Toast.LENGTH_LONG).show()
            }
        }
        
        // Initialize with model
        viewModel.initializeWithModel(modelId)
    }
    
    private fun setupRecyclerView() {
        chatAdapter = ChatMessageAdapter()
        
        binding.recyclerView.apply {
            layoutManager = LinearLayoutManager(this@ChatActivity)
            adapter = chatAdapter
        }
    }
    
    private fun setupClickListeners() {
        binding.sendButton.setOnClickListener {
            sendMessage()
        }
        
        binding.inputText.setOnEditorActionListener { _, _, _ ->
            sendMessage()
            true
        }
    }
    
    private fun sendMessage() {
        val message = binding.inputText.text.toString().trim()
        if (message.isNotEmpty()) {
            viewModel.sendMessage(message)
            binding.inputText.text?.clear()
        }
    }
    
    override fun onCreateOptionsMenu(menu: Menu?): Boolean {
        menuInflater.inflate(R.menu.chat_menu, menu)
        return true
    }
    
    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        return when (item.itemId) {
            android.R.id.home -> {
                finish()
                true
            }
            R.id.action_clear_chat -> {
                viewModel.clearChat()
                true
            }
            R.id.action_export_chat -> {
                viewModel.exportChat()
                true
            }
            else -> super.onOptionsItemSelected(item)
        }
    }
}