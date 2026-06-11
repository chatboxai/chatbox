# 常见问题

<p align="center">
    <a href="./FAQ.md">English</a> | 中文
</p>

这里列举了一些最常见的问题和解决方案。如果你依然没有找到答案，也可以提交一个 [Issue](https://github.com/Bin-Huang/chatbox/issues/new/choose)。

### 1001

#### 消息发送失败，提示 `Failed to fetch`？

这是因为 Chatbox 无法连接到你设置的 AI 模型服务器，请检查你当前的网络环境，确保可以正常连接到 AI 模型服务器。

对于 OpenAI API 的用户，如果你选择了 OpenAI API 作为 AI 模型提供方（即设置页的 AI Provider 中选择了 `OpenAI API`），那么一般是 Chatbox 无法访问设置的 `API HOST`。在默认设置下，Chatbox 会使用 `https://api.openai.com` 作为 API HOST，请确保你的当前网络可以访问这个服务。注意，在某些国家和地区是无法直接访问的。

### 1002

#### 以前用的好好的，突然报错 `{"error":{"message":"You exceeded your current quota, please check your plan and billing details.`？

如果你以前使用一切正常，某天之后突然无法使用过，并且每次发送消息都报错：

```
{"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","param":null,"code":null}}
```

请注意，这个问题和 Chatbox 没有任何关系。这个情况中往往是因为你正在使用自己的 OpenAI API 账户，而你账户中的免费额度已经全部用完或过期了（一般都是因为过期导致的）。你需要自行登录 OpenAI 账户的控制台，绑定一张海外信用卡才能继续使用。OpenAI API 账户对信用卡有很多要求，如果你的信用卡不符合要求，那么你需要自行解决（非常折腾）。

**更推荐使用 `Chatbox AI`：** 如果你不想折腾这些问题，也可以使用 Chatbox 内置的 `Chatbox AI` 服务。这个服务可以让你无需折腾、什么都不用管、轻松使用 AI 能力。前往配置页，将 AI Provider 设置为 `Chatbox AI`，你将看到相应的设置。

### 1003

#### 无法使用 GPT-4？

如果你选择 GPT-4，然后发送消息时得到类似的报错：

```
{"error":{"message":"The model: gpt-4-32k does not exist","type":"invalid_request_error","param":null,"code":"model_not_found"}}
```

这个情况往往是因为你正在使用自己的 OpenAI 账户，你在模型中选择了 GPT-4，但 OpenAI API 账户不支持 GPT-4。截止到 2023 年 07 月 04 日，所有 OpenAI API 账户都需要向 OpenAI 填写申请后才能使用 GPT-4 模型。这里是申请链接： https://openai.com/waitlist/gpt-4-api 。请注意，即使你是 ChatGPT Plus 用户，你也需要申请后才能使用 GPT-4 的 API 模型。

### 1004

#### 在 Windows/Linux 下不小心按了 F11 进入全屏，怎么退出？

在 Windows/Linux 桌面版中，按 **F11** 可以切换全屏模式。如果误入了全屏并且无法退出，可以通过以下任一方式恢复：

- 再次按下 **F11** 键即可退出全屏。
- 将鼠标移到**窗口顶部中间区域**，会有一个隐藏的退出按钮，点击即可退出全屏。
