import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import './App.css'

function App() {
  const [greetMsg, setGreetMsg] = useState('')
  const [name, setName] = useState('')

  async function greet() {
    // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
    setGreetMsg(await invoke('greet', { name }))
  }

  return (
    <main className="container min-h-screen flex flex-col items-start justify-center gap-4 p-8 max-w-[80%] mx-auto">
      <h1 className="text-4xl font-bold tracking-tight text-foreground mb-4">
        Welcome to the Humanlayer WUI, a HumanLayer Experiment
      </h1>

      <form
        className="flex flex-row gap-2"
        onSubmit={e => {
          e.preventDefault()
          greet()
        }}
      >
        <Input
          id="greet-input"
          onChange={e => setName(e.currentTarget.value)}
          placeholder="Enter a name..."
        />
        <Button type="submit">Greet</Button>
      </form>
      <p>{greetMsg}</p>
    </main>
  )
}

export default App
