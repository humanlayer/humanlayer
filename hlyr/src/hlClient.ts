interface Project {
  name: string
  slug: string
  organization: string
}

export function getProject(apiBase: string, apiKey: string) {
  return fetch(`${apiBase}/project`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  }).then(res => {
    if (!res.ok) {
      throw new Error(`Failed to get project: ${res.status} ${res.statusText}`)
    }
    return res.json() as Promise<Project>
  })
}
