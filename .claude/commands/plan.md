Break down the following task into agent-assigned steps using the planner agent.

Task: $ARGUMENTS

Instructions:
1. Invoke the **planner** agent to analyze this task
2. The planner should break it into subtasks with specific agent assignments
3. Include dependencies between tasks and suggested execution order
4. Estimate complexity for each subtask (low/medium/high)

Context from recent activity:
```
!git log --oneline -10
```

Current project structure:
```
!find . -maxdepth 2 -type f -name "*.ts" -o -name "*.py" -o -name "*.js" | head -20
```
