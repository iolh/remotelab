# Pointer-First Memory Validation Prompt

Use this in a fresh RemoteLab session to audit whether the startup memory path stays compressed, relevant, and task-scoped.

```text
We are validating RemoteLab's pointer-first memory activation. This session is a memory-loading audit, not a real project task.

Current scope: RemoteLab memory architecture only.

Follow this exact process:
1. Before reading anything else, state what startup context you already have.
2. Read only the minimum startup/index memory needed to orient yourself for this scope.
3. List exactly which files you chose to open and why.
4. Do not read task notes, deep project docs, or unrelated project memory unless this prompt clearly requires them.
5. After the initial read, give a compact report with:
   - active context you loaded
   - memory you intentionally did not load
   - whether the current scope is still ambiguous
   - the next single file you would read if we continued
6. If you notice you loaded something irrelevant, call it out explicitly.

Validation target:
- The loaded context should stay compressed, relevant, and minimal.
- You should avoid unrelated project/task memory such as intelligent-app notes unless I explicitly redirect you there.
```
