export const L2_SYSTEM_PROMPT = [
  '你是负责长程多轮任务“结构化提纯/因果记忆”的子智能体，只处理当前分配的独立任务块。',
  '你的输出必须通过结构化工具提交，任何自然语言自由总结都不可替代该工具。',
  '你的工具输出将直接写入上下文用于后续推理与远古召回，因此必须严格依据输入块的原文事实。',
  '强制规则：',
  '- 必须调用 submit_curated_task_memory 工具提交本块记忆，禁止只输出自由文本',
  '- task_goal、causal_steps、evidence_fragments、conclusion、next_action、working_state 为必填',
  '- causal_steps 至少 1 条，每条包含 intent / tool_action / result 的实质内容，不能为空对象',
  '- evidence_fragments 至少 1 条，每条包含 source / fragment / relevance，fragment 需为原文可验证片段',
  '- conclusion 必须与当前块实际结果一致；status 语义不得逆转块完成态',
  '- next_action 必须给出下一步可执行的最小动作，而不是空泛总结',
  '- working_state 必须填 current_goal 与 rejected_decisions / effective_decisions / architecture_boundaries / remaining_work',
  '- 证据只能来自当前输入块，禁止编造',
].join('\n')

export const L2_TOOL_SCHEMA = {
  name: 'submit_curated_task_memory',
  description: '为当前任务块提交结构化因果记忆，用于长程上下文提纯与远古召回',
  parameters: {
    type: 'object',
    properties: {
      task_goal: { type: 'string', description: '当前块要解决的核心目标' },
      causal_steps: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            intent: { type: 'string', description: '本步意图' },
            tool_action: { type: 'string', description: '关键工具动作或检查路径' },
            result: { type: 'string', description: '本步产生的关键结果或失败原因' },
          },
          required: ['intent', 'tool_action', 'result'],
        },
      },
      evidence_fragments: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            source: { type: 'string', description: '证据来源，如文件路径或工具输出定位' },
            fragment: { type: 'string', description: '可验证证据片段' },
            relevance: { type: 'string', description: '该证据对当前块结论的关联说明' },
          },
          required: ['source', 'fragment', 'relevance'],
        },
      },
      conclusion: { type: 'string', description: '当前块最终结论' },
      next_action: { type: 'string', description: '下一步最小可执行动作' },
      working_state: {
        type: 'object',
        properties: {
          current_goal: { type: 'string' },
          effective_decisions: { type: 'array', items: { type: 'string' } },
          rejected_decisions: { type: 'array', items: { type: 'string' } },
          architecture_boundaries: { type: 'array', items: { type: 'string' } },
          remaining_work: { type: 'array', items: { type: 'string' } },
        },
        required: [
          'current_goal',
          'effective_decisions',
          'rejected_decisions',
          'architecture_boundaries',
          'remaining_work',
        ],
      },
      status_hint: {
        type: 'string',
        enum: ['DONE', 'PENDING', 'UNKNOWN'],
        description: '块完成态提示，默认根据块状态推断',
      },
    },
    required: ['task_goal', 'causal_steps', 'evidence_fragments', 'conclusion', 'next_action', 'working_state'],
  },
}

export const L2_BUILTIN_CURATOR_CONFIG = {
  systemPrompt: L2_SYSTEM_PROMPT,
  toolName: L2_TOOL_SCHEMA.name,
  tool: {
    type: 'function',
    function: {
      name: L2_TOOL_SCHEMA.name,
      description: L2_TOOL_SCHEMA.description,
      parameters: L2_TOOL_SCHEMA.parameters,
    },
  },
  requiredFields: ['task_goal', 'causal_steps', 'evidence_fragments', 'conclusion', 'next_action', 'working_state'],
  maxAttempts: 5,
}

export const L2_MISSING_TOOL_RETRY_HINT = '你必须调用 submit_curated_task_memory 提交结构化记忆，自然语言回复无效。'

export const L2_REQUIRED_FIELDS_HINT_PREFIX = '提交被拒绝，缺少或为空的字段：'
