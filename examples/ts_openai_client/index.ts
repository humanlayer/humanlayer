

import { HumanLayer } from "humanlayer";
import OpenAI from "openai";


const openAIHello = async () => {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: "Hello, world!" }],
    });
};

openAIHello().catch(console.error);