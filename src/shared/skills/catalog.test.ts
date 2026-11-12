import { describe, expect, it } from 'vitest'
import { formatLoadSkillOutput } from './catalog'

describe('shared skill model output', () => {
  it('formats portable instructions and desktop skill files using the same contract', () => {
    expect(formatLoadSkillOutput({ instructions: '# Local skill' })).toBe('# Local skill')
    expect(
      formatLoadSkillOutput({
        instructions: '# Desktop skill',
        skillRoot: '/skills/report',
        files: ['reference.md', 10],
      })
    ).toBe(
      '# Desktop skill\n\nSkill root: /skills/report\nReplace <SKILL_ROOT> with this absolute path when using referenced files.\n\nAvailable skill files:\n- reference.md'
    )
  })
  it('preserves error and empty-instruction handling for host adapters', () => {
    expect(formatLoadSkillOutput({ error: 'Not enabled', instructions: 'ignored' })).toBe('Error: Not enabled')
    expect(formatLoadSkillOutput({ instructions: '' })).toBe('')
  })
})
