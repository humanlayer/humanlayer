interface Project {
  name: string
  slug: string
  organization: string
}

export function getProject(apiBase: string, apiKey: string) {
  console.log('hitting getProject on ', apiBase, apiKey)
  return fetch(`${apiBase}/humanlayer/v1/project`, {
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
