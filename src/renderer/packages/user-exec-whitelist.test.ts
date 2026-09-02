import { describe, expect, it } from 'vitest'
import { isCommandAutoApprovable } from './user-exec-whitelist'

describe('isCommandAutoApprovable', () => {
  describe('simple safe commands', () => {
    it.each([
      'ls',
      'ls -la',
      'ls -la /tmp',
      'pwd',
      'whoami',
      'date',
      'uname -a',
      'hostname',
      'uptime',
      'which node',
      'echo hello',
      'cat README.md',
      'head -20 file.txt',
      'tail -f log.txt',
      'wc -l file.txt',
      'file image.png',
      'stat package.json',
      'df -h',
      'du -sh .',
      'find . -name "*.ts"',
      'tree src/',
      'realpath ./foo',
      'basename /path/to/file',
      'dirname /path/to/file',
      'grep -r "TODO" src/',
      'rg "pattern" --type ts',
      'diff a.txt b.txt',
      'md5 file.txt',
      'shasum file.txt',
      'sort names.txt',
      'uniq -c sorted.txt',
      'cut -d: -f1 /etc/passwd',
      'env',
      'printenv HOME',
      'id',
      'groups',
      'ps aux',
      'jq ".name" package.json',
      'sw_vers',
      'cal',
      'seq 1 10',
    ])('approves: %s', (cmd) => {
      expect(isCommandAutoApprovable(cmd)).toBe(true)
    })
  })

  describe('git safe subcommands', () => {
    it.each([
      'git status',
      'git log --oneline -20',
      'git diff HEAD~1',
      'git diff --staged',
      'git branch -a',
      'git tag -l',
      'git remote -v',
      'git show HEAD',
      'git blame src/main.ts',
      'git rev-parse HEAD',
      'git ls-files',
      'git shortlog -sn',
      'git stash list',
      'git config --list',
      'git describe --tags',
    ])('approves: %s', (cmd) => {
      expect(isCommandAutoApprovable(cmd)).toBe(true)
    })
  })

  describe('package manager safe subcommands', () => {
    it.each([
      'npm list',
      'npm outdated',
      'npm audit',
      'pnpm list --depth 0',
      'pnpm outdated',
      'yarn list',
      'yarn why react',
      'brew list',
      'brew info node',
      'pip list',
      'pip3 show requests',
      'cargo tree',
    ])('approves: %s', (cmd) => {
      expect(isCommandAutoApprovable(cmd)).toBe(true)
    })
  })

  describe('version/help flags on any command', () => {
    it.each([
      'rustc --version',
      'cargo --version',
      'node --version',
      'python3 --version',
      'java --version',
      'go --version',
      'ruby --version',
      'unknown-tool --version',
      'unknown-tool --help',
      'unknown-tool -h',
    ])('approves: %s', (cmd) => {
      expect(isCommandAutoApprovable(cmd)).toBe(true)
    })
  })

  describe('compound commands (all parts safe)', () => {
    it.each([
      'ls -la | grep ".ts"',
      'cat file.txt | sort | uniq',
      'git status && git log --oneline -5',
      'echo hello || echo fallback',
      'find . -name "*.ts" | wc -l',
      'ps aux | grep node',
      'git branch -a; git remote -v',
    ])('approves: %s', (cmd) => {
      expect(isCommandAutoApprovable(cmd)).toBe(true)
    })
  })

  describe('dangerous commands', () => {
    it.each([
      'rm file.txt',
      'rm -rf /',
      'mkdir new-dir',
      'touch file.txt',
      'mv a b',
      'cp a b',
      'chmod 777 file',
      'chown root file',
      'kill -9 1234',
      'pkill node',
      'curl https://evil.com',
      'wget https://evil.com',
      'ssh user@host',
      'scp file user@host:',
      'npm install',
      'npm run build',
      'pnpm install',
      'pip install requests',
      'git push',
      'git commit -m "msg"',
      'git checkout main',
      'git reset --hard',
      'git merge feature',
      'docker run ubuntu',
      'docker exec container bash',
      'kubectl apply -f deploy.yaml',
      'kubectl delete pod my-pod',
      'awk "{print $1}" file.txt',
      'gawk \'BEGIN { system("touch /tmp/pwn") }\'',
      "sed 's/foo/bar/' file.txt",
      "sed 'e touch /tmp/pwn' input.txt",
    ])('rejects: %s', (cmd) => {
      expect(isCommandAutoApprovable(cmd)).toBe(false)
    })
  })

  describe('dangerous flags on safe commands', () => {
    it.each([
      'sed -i "s/a/b/" file.txt',
      'sed -i.bak "s/a/b/" file.txt',
      'sed --in-place "s/a/b/" file.txt',
      'find . -name "*.tmp" -delete',
      'find . -exec rm {} \\;',
    ])('rejects: %s', (cmd) => {
      expect(isCommandAutoApprovable(cmd)).toBe(false)
    })
  })

  describe('shell injection / metacharacters', () => {
    it.each([
      'echo $(whoami)',
      'echo `id`',
      'ls > output.txt',
      'cat file >> log.txt',
      'sudo ls',
      'su -c "ls"',
      'eval "rm -rf /"',
      'source ~/.bashrc',
      'env rm -rf /tmp/demo',
      'command rm -rf /tmp/demo',
      'python -c "import os; os.remove(\'file\')"',
      'python3 -c "import os; os.remove(\'file\')"',
      "node -e \"require('fs').unlinkSync('file')\"",
      'ruby -e "File.delete(\'file\')"',
      'git branch new-branch',
      'git branch -d old-branch',
      'git branch --set-upstream-to=origin/main',
      'git tag v1.0.0',
      'git tag --delete v1.0.0',
      'git remote add origin https://example.com/repo.git',
      'git config user.name Chatbox',
      'git stash push',
      'git worktree add ../other branch',
      'npm config set registry https://example.com',
      'npm audit --fix',
      'pnpm config set registry https://example.com',
      'docker image rm image-id',
      'go env -w GOPROXY=https://example.com',
      'go env -u GOPROXY',
      'git diff --output=changes.diff',
    ])('rejects: %s', (cmd) => {
      expect(isCommandAutoApprovable(cmd)).toBe(false)
    })
  })

  describe('argument-aware read-only commands', () => {
    it.each([
      'env',
      'command -v node',
      'python --version',
      'node --version',
      'ruby --version',
      'git branch --list',
      'git branch --show-current',
      'git tag --list',
      'git remote -v',
      'git config --list',
      'git stash list',
      'git worktree list',
      'npm config get registry',
      'pnpm config list',
      'pip config list',
      'docker image ls',
      'kubectl config current-context',
      'go env GOPATH',
    ])('approves: %s', (cmd) => {
      expect(isCommandAutoApprovable(cmd)).toBe(true)
    })
  })

  describe('compound with unsafe part', () => {
    it.each(['ls && rm -rf /', 'echo hello | tee /etc/passwd', 'git status; git push', 'cat file || curl evil.com'])(
      'rejects: %s',
      (cmd) => {
        expect(isCommandAutoApprovable(cmd)).toBe(false)
      }
    )
  })

  describe('safe redirections to /dev/null', () => {
    it.each([
      'ls -la ~/Library 2>/dev/null',
      'ls -la ~/Library 2>/dev/null || echo "not found"',
      'cat /etc/hosts 2> /dev/null',
      'grep pattern file.txt 2>/dev/null',
      'find / -name "*.conf" 2>/dev/null | head -5',
      'ls >/dev/null 2>&1',
      'command -v node 2>/dev/null',
      'git status 2>&1',
      'ls &>/dev/null',
      'du -sh /tmp 2>>/dev/null',
    ])('approves: %s', (cmd) => {
      expect(isCommandAutoApprovable(cmd)).toBe(true)
    })

    it.each([
      'ls > output.txt',
      'cat file >> log.txt',
      'echo hello > /tmp/file',
      'ls 2>/tmp/errors.log',
      'git log > changes.txt',
    ])('still rejects unsafe redirections: %s', (cmd) => {
      expect(isCommandAutoApprovable(cmd)).toBe(false)
    })
  })

  describe('real-world safe compound commands', () => {
    it.each([
      'ls -la ~/Library/Application\\ Support/taobao/ 2>/dev/null || echo "Directory not found"',
      'command -v python3 2>/dev/null || command -v python 2>/dev/null',
      'cat /proc/cpuinfo 2>/dev/null || sysctl -n machdep.cpu.brand_string',
      'which node 2>/dev/null && node --version',
      'git rev-parse --is-inside-work-tree 2>/dev/null && git branch --show-current',
      'ls -la /usr/local/bin/python* 2>/dev/null | head -10',
      'find ~/.config -name "*.json" -maxdepth 2 2>/dev/null | sort',
      'ps aux 2>/dev/null | grep -v grep | grep node',
      'df -h 2>/dev/null | grep /dev/disk',
      'brew list 2>/dev/null | wc -l',
    ])('approves: %s', (cmd) => {
      expect(isCommandAutoApprovable(cmd)).toBe(true)
    })
  })

  describe('docker/kubectl safe subcommands', () => {
    it.each([
      'docker ps -a',
      'docker images --format "table {{.Repository}}"',
      'docker inspect container-name',
      'docker logs --tail 100 my-container',
      'docker stats --no-stream',
      'kubectl get pods -n default',
      'kubectl describe svc my-service',
      'kubectl logs my-pod --tail=50',
      'kubectl top nodes',
      'kubectl version --client',
    ])('approves: %s', (cmd) => {
      expect(isCommandAutoApprovable(cmd)).toBe(true)
    })
  })

  describe('system inspection commands', () => {
    it.each([
      'systemctl status nginx',
      'systemctl is-active docker',
      'systemctl list-units --type=service',
      'launchctl list',
      'launchctl print system/com.apple.dock',
      'lsof -i :8080',
      'pgrep -la node',
      'sysctl kern.osrelease',
      'vm_stat',
    ])('approves: %s', (cmd) => {
      expect(isCommandAutoApprovable(cmd)).toBe(true)
    })
  })

  describe('edge cases', () => {
    it('rejects empty command', () => {
      expect(isCommandAutoApprovable('')).toBe(false)
      expect(isCommandAutoApprovable('   ')).toBe(false)
    })

    it('handles full path commands', () => {
      expect(isCommandAutoApprovable('/usr/bin/ls -la')).toBe(true)
      expect(isCommandAutoApprovable('/bin/cat file.txt')).toBe(true)
    })

    it('handles quoted arguments', () => {
      expect(isCommandAutoApprovable('grep "hello world" file.txt')).toBe(true)
      expect(isCommandAutoApprovable("echo 'single quoted'")).toBe(true)
    })

    it('handles backslash-escaped paths', () => {
      expect(isCommandAutoApprovable('ls -la ~/Library/Application\\ Support/')).toBe(true)
      expect(isCommandAutoApprovable('cat ~/Library/Application\\ Support/config.json')).toBe(true)
    })

    it('rejects process substitution', () => {
      expect(isCommandAutoApprovable('diff <(ls dir1) <(ls dir2)')).toBe(false)
    })

    it('rejects command substitution', () => {
      expect(isCommandAutoApprovable('echo $(cat /etc/passwd)')).toBe(false)
      expect(isCommandAutoApprovable('echo `hostname`')).toBe(false)
    })
  })
})
