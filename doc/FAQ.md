# Frequently Asked Questions

<p align="center">
    English | <a href="./FAQ-CN.md">中文</a>
</p>

If you still haven't found the answer you're looking for, feel free to submit an [Issue](https://github.com/Bin-Huang/chatbox/issues/new/choose) as well.

### 1001

#### Message sending failed, showing `Failed to fetch`?

This issue occurs when Chatbox cannot connect to the AI model server you've set up. Please check your current network environment and make sure it can connect properly to the AI model server.

For OpenAI API users, if you've chosen OpenAI API as the AI model provider (meaning you've selected `OpenAI API` in the AI Provider settings), it's typically because Chatbox cannot access the `API HOST` you've set. By default, Chatbox uses `https://api.openai.com` as the API HOST. Please make sure your current network can access this service.

### 1002

#### Everything was working fine before, but now I keep getting an error: `{"error":{"message":"You exceeded your current quota, please check your plan and billing details`?

If everything was working fine before and now you're unable to use the service, with each message sending attempt resulting in the following error:

```
{"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","param":null,"code":null}}
```

Please note that this issue is not related to Chatbox. In this situation, it's likely that you're using your own OpenAI API account and your free quota has either been used up or expired (usually due to expiration). You need to log in to your OpenAI account's dashboard and link a credit card to continue using the service. The OpenAI API account has many requirements for credit cards. If your card doesn't meet these requirements, you'll need to resolve this issue yourself (it can be quite frustrating).

**Consider using `Chatbox AI`:** If you don't want to deal with these issues, you can also use Chatbox's built-in `Chatbox AI` service. This service allows you to enjoy AI capabilities without any hassle. Go to the settings page and set the AI Provider to `Chatbox AI`, and you'll see the corresponding options.

### 1003

#### Unable to use GPT-4?

If you select GPT-4 and receive a similar error message when sending messages:

```
{"error":{"message":"The model: gpt-4-32k does not exist","type":"invalid_request_error","param":null,"code":"model_not_found"}}
```

This issue often occurs when you're using your own OpenAI account and have selected the GPT-4 model, but your OpenAI API account does not support GPT-4. As of July 4, 2023, all OpenAI API accounts require a request to be submitted to OpenAI before the GPT-4 model can be used. Here's the application link: https://openai.com/waitlist/gpt-4-api. Please note that even if you're a ChatGPT Plus user, you still need to apply for access to use the GPT-4 API model.

### 1004

#### On Windows/Linux I accidentally pressed F11 and entered fullscreen. How do I exit?

On Windows/Linux desktop versions, press **F11** to toggle fullscreen mode. If you accidentally entered fullscreen and can't figure out how to exit, try one of the following:

- Press **F11** again to exit fullscreen.
- Move your mouse to the **top center area of the window** — a hidden exit button will appear. Click it to exit fullscreen.
