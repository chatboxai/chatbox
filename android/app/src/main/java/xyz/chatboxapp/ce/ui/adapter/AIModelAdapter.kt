package xyz.chatboxapp.ce.ui.adapter

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import xyz.chatboxapp.ce.data.model.AIModel
import xyz.chatboxapp.ce.databinding.ItemAiModelBinding

class AIModelAdapter(
    private val onModelClick: (AIModel) -> Unit
) : ListAdapter<AIModel, AIModelAdapter.ModelViewHolder>(ModelDiffCallback()) {
    
    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ModelViewHolder {
        val binding = ItemAiModelBinding.inflate(
            LayoutInflater.from(parent.context),
            parent,
            false
        )
        return ModelViewHolder(binding)
    }
    
    override fun onBindViewHolder(holder: ModelViewHolder, position: Int) {
        holder.bind(getItem(position))
    }
    
    inner class ModelViewHolder(
        private val binding: ItemAiModelBinding
    ) : RecyclerView.ViewHolder(binding.root) {
        
        fun bind(model: AIModel) {
            binding.modelName.text = model.getDisplayName()
            binding.providerBadge.text = model.provider
            binding.modelDescription.text = model.description
            
            // Set pricing
            binding.pricingText.text = "$${model.pricing.input}/1K input, $${model.pricing.output}/1K output"
            
            // Set context window
            binding.contextWindow.text = "${model.contextWindow / 1000}K context"
            
            // Set capabilities
            val capabilities = model.getCapabilityIcons()
            binding.capability1.text = capabilities.getOrNull(0) ?: ""
            binding.capability2.text = capabilities.getOrNull(1) ?: ""
            binding.capability3.text = capabilities.getOrNull(2) ?: ""
            
            // Hide unused capability views
            binding.capability1.visibility = if (capabilities.isNotEmpty()) View.VISIBLE else View.GONE
            binding.capability2.visibility = if (capabilities.size > 1) View.VISIBLE else View.GONE
            binding.capability3.visibility = if (capabilities.size > 2) View.VISIBLE else View.GONE
            
            // Set click listener
            binding.root.setOnClickListener {
                onModelClick(model)
            }
        }
    }
    
    class ModelDiffCallback : DiffUtil.ItemCallback<AIModel>() {
        override fun areItemsTheSame(oldItem: AIModel, newItem: AIModel): Boolean {
            return oldItem.modelId == newItem.modelId
        }
        
        override fun areContentsTheSame(oldItem: AIModel, newItem: AIModel): Boolean {
            return oldItem == newItem
        }
    }
}