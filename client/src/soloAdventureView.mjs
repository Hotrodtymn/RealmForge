export function chooseSession(sessions, selectedId = '') {
  if (selectedId && sessions.some((session) => session.id === selectedId)) return selectedId
  return sessions.find((session) => session.status === 'active' || session.status === 'paused')?.id ?? sessions[0]?.id ?? ''
}

export function sceneSelection(scenes, currentScene, selectedId = '') {
  const selectedScene = scenes.find((scene) => scene.id === selectedId) ?? currentScene ?? null
  return {
    scene: selectedScene,
    isCurrent: !selectedId || selectedId === currentScene?.id,
  }
}

export function canRecordDecision(sessionStatus, isCurrentScene, decisionText, submitting) {
  return sessionStatus === 'active' && isCurrentScene && Boolean(decisionText.trim()) && !submitting
}

export function playerCharacterSummary(character) {
  if (!character) return null
  return {
    id: character.id,
    name: character.name,
    species: character.species ?? '',
    class: character.class ?? '',
    level: character.level ?? null,
  }
}
