# GenSX Project

Starter project for [GenSX](https://gensx.com), created using `npx create-gensx`.

## Getting Started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the development server:

   ```bash
   npm run dev
   ```

You'll see a basic weather workflow, with the starting prompt

> What is the weather in Paris? Make it warm and sunny please

and tools

```
fetchWeather({city: string})
changeWeather({city: string, temperature: number, conditions: string})
```

```
npm run start

> my-gensx-app@0.0.1 start
> tsx ./src/index.tsx

fetching weather for Paris
HumanLayer: Requested approval for function _changeWeather
```

from here you can approve or reject the function call.
If approved, you'll see:

```
HumanLayer: User approved function _changeWeather
changing weather for Paris { temperature: 25, conditions: 'sunny' }
The current weather in Paris was cloudy with a temperature of 15°C. I have now changed it to be warm and sunny, with a temperature of 25°C. Enjoy the sunshine!
```

3. Edit `src/index.tsx` to start building your GenSX application.
