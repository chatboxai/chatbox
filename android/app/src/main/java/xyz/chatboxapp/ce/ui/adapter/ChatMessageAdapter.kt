package xyz.chatboxapp.ce.ui.adapter

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import xyz.chatboxapp.ce.data.model.ChatMessage
import xyz.chatboxapp.ce.databinding.ItemChatMessageBinding
import java.text.SimpleDateFormat
import java.util.*

class ChatMessageAdapter : ListAdapter<ChatMessage, ChatMessageAdapter.MessageViewHolder>(MessageDiffCallback()) {
    
    private val timeFormat = SimpleDateFormat("h:mm a", Locale.getDefault())
    
    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): MessageViewHolder {
        val binding = ItemChatMessageBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false
        )
        return MessageViewHolder(binding)
    }
    
    override fun onBindViewHolder(holder: MessageViewHolder, position: Int) {
        holder.bind(getItem(position))
    }
    
    inner class MessageViewHolder(
        private val binding: ItemChatMessageBinding
    ) : RecyclerView.ViewHolder(binding.root) {
        
        fun bind(message: ChatMessage) {
            when (message.type) {
                ChatMessage.MessageType.USER -> {
                    binding.messageContent.text = message.content
                    binding.messageTime.text = timeFormat.format(Date(message.timestamp))
                    binding.root.findViewById<View>(android.R.id.message_content).visibility = View.VISIBLE
                    binding.assistantMessageCard.visibility = View.GONE
                }
                ChatMessage.MessageType.ASSISTANT -> {
                    binding.assistantMessageContent.text = message.content
                    binding.assistantMessageTime.text = timeFormat.format(Date(message.timestamp))
                    binding.modelInfo.text = message.modelId ?: "AI"
                    binding.root.findViewById<View>(android.R.id.message_content).visibility = View.GONE
                    binding.assistantMessageCard.visibility = View.VISIBLE
                }
                ChatMessage.MessageType.ERROR -> {
                    binding.assistantMessageContent.text = "Error: ${message.content}"
                    binding.assistantMessageTime.text = timeFormat.format(Date(message.timestamp))
                    binding.modelInfo.text = "Error"
                    binding.root.findViewById<View>(android.R.id.message_content).visibility = View.GONE
                    binding.assistantMessageCard.visibility = View.VISIBLE
                }
                else -> {
                    // Hide both views for system messages
                    binding.root.findViewById<View>(android.R.id.message_content).visibility = View.GONE
                    binding.assistantMessageCard.visibility = View.GONE
                }
            }
        }
    }
    
    class MessageDiffCallback : DiffUtil.ItemCallback<ChatMessage>() {
        override fun areItemsTheSame(oldItem: ChatMessage, newItem: ChatMessage): Boolean {
            return oldItem.id == newItem.id
        }
        
        override fun areContentsTheSame(oldItem: ChatMessage, newItem: ChatMessage): Boolean {
            return oldItem == newItem
        }
    }
}