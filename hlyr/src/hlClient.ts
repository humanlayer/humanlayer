interface Project {
  name: string
  slug: string
  organization: string
}

export function getProject(apiBase: string, apiKey: string) {
  return fetch(`${apiBase}/humanlayer/v1/project`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  }).then(res => res.json() as Promise<Project>)
}
