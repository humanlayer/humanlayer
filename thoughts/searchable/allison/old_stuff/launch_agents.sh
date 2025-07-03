#!/bin/bash

# launch_agents.sh - Launch agents in existing worktrees to fix TUI issues
# This script assumes worktrees have already been created with create_worktrees.sh

set -e  # Exit on any error

# Base paths
WORKTREES_BASE="$HOME/.humanlayer/worktrees"
REPO_BASE_NAME=$(basename "$(pwd)")

# Array of task names that should have worktrees
declare -a TASK_NAMES=(
    "session_sorting_priority"
    "tab_switching_navigation" 
    "session_detail_scrolling"
    "message_count_display"
    "extra_header_text_fix"
    "working_directory_inheritance"
)

# Array of agent prompts for the 6 TUI fixes
declare -a AGENT_PROMPTS=(

# 1. Session Sorting Priority Fix
"Fix the session sorting priority issue where \"waiting_input\" status sessions don't appear at the top of the list.

**Problem**: Sessions requiring user approval (status \"waiting_input\") currently fall into the default case with priority 3, appearing below completed and failed sessions. This makes it hard for users to find sessions that need their attention.

**Root Cause**: The statusPriority function in humanlayer-tui/sessions.go (lines 157-168) doesn't explicitly handle \"waiting_input\" status.

**Current Priority Order**: 
- Priority 0: running, starting (highest)
- Priority 1: completed  
- Priority 2: failed
- Priority 3: waiting_input (and others) - WRONG!

**Required Fix**:
1. Edit \`/Users/allison/humanlayer/humanlayer/humanlayer-tui/sessions.go\` lines 157-168
2. Add explicit case for \"waiting_input\" with priority 0 (highest priority)
3. Consider adding a status icon for \"waiting_input\" (currently missing from lines 557-567)

**Expected Priority Order After Fix**:
- Priority 0: waiting_input, running, starting (sessions needing attention first)
- Priority 1: completed
- Priority 2: failed

**Implementation Details**:
- Change the switch statement in statusPriority function
- waiting_input sessions should appear above even running sessions since they need user action
- The status constant is defined as SessionStatusWaitingInput = \"waiting_input\" in hld/store/store.go

**Finished Result**: The TUI should show sessions with \"waiting_input\" status at the very top of the sessions list. Tell the user to test the TUI by creating an approval scenario and verifying waiting_input sessions appear first.

**Commit Instructions**: Commit after making the statusPriority change with message describing the fix.

**Testing/Formatting**: If you want to check formatting or run tests, spawn a sub-task with read-only intention and prompt \"Run \`make check test\` and return the pieces of information that are useful to resolving formatting or test issues.\"

**Sub-tasks**: If you want to spawn sub-tasks, only spawn them with read-only intention and be explicit about that fact."


# 2. Tab Switching Navigation Fix  
"Fix the tab switching navigation issue where pressing \"1\" or \"2\" doesn't exit conversation view.

**Problem**: When viewing a conversation, pressing \"1\" or \"2\" changes the activeTab but doesn't clear the conversation view, creating janky UX where the tab switches but conversation view remains open.

**Root Cause**: The handleTabSwitching function in humanlayer-tui/tui.go (lines 492-522) switches activeTab but doesn't clear conversation.sessionID, so getCurrentViewState() still returns conversationView.

**Current Behavior**:
1. User enters conversation view (sessionID gets set)
2. User presses \"1\" or \"2\" 
3. activeTab changes successfully
4. BUT getCurrentViewState() still returns conversationView because sessionID != \"\"
5. View rendering shows conversation instead of new tab's list

**Required Fix**:
1. Edit \`/Users/allison/humanlayer/humanlayer/humanlayer-tui/tui.go\` lines 492-522
2. Modify both numeric tab switching cases (\"1\" and \"2\") to clear conversation state
3. Add conversation cleanup code similar to ESC key handling (lines 325-330)

**Implementation Details**:
- In handleTabSwitching, for both Tab1 and Tab2 cases, add:
  \`\`\`go
  // Clear conversation view when switching tabs
  if m.conversation.sessionID != \"\" {
      m.conversation.stopPolling()
      m.conversation.sessionID = \"\"
  }
  \`\`\`
- This ensures tab switching always exits conversation view and shows the requested tab's list
- ESC key already does this correctly (lines 325-330), use that as reference

**Finished Result**: When in conversation view, pressing \"1\" or \"2\" should exit the conversation and show the selected tab's list view. Tell the user to test the TUI by entering a conversation, then pressing \"1\" and \"2\" to verify tab switching works properly.

**Commit Instructions**: Commit after implementing the tab switching fix with message describing the navigation improvement.

**Testing/Formatting**: If you want to check formatting or run tests, spawn a sub-task with read-only intention and prompt \"Run \`make check test\` and return the pieces of information that are useful to resolving formatting or test issues.\"

**Sub-tasks**: If you want to spawn sub-tasks, only spawn them with read-only intention and be explicit about that fact."


# 3. Session Detail Infinite Scrolling Fix
"Fix the session detail infinite scrolling issue where users can scroll past content with j/k keys.

**Problem**: Users can press 'j' (down) infinitely past the bottom of session detail content, requiring the same number of 'k' (up) presses to scroll back to normal viewing. This creates poor UX when reviewing long session details.

**Root Cause**: The Down key handler in updateSessionDetailView (lines 220-227) unconditionally increments sessionDetailScroll without bounds checking, while the Up key handler has proper bounds checking.

**Current Implementation Issue**:
- Up key: \`if sm.sessionDetailScroll > 0 { sm.sessionDetailScroll-- }\` (HAS bounds)
- Down key: \`sm.sessionDetailScroll++\` (NO bounds checking)

**Required Fix**:
1. Edit \`/Users/allison/humanlayer/humanlayer/humanlayer-tui/sessions.go\` lines 220-227
2. Add symmetric bounds checking to Down key handler using same logic as renderSessionDetailView

**Implementation Details**:
- The renderSessionDetailView function (lines 756-765) already calculates proper bounds
- Use the same calculation in the Down key handler:
  \`\`\`go
  case key.Matches(msg, keys.Down):
      // Calculate bounds using same logic as render function
      if sm.selectedSession != nil {
          content := sm.buildSessionDetailContent(sm.selectedSession)
          lines := strings.Split(content, \"\\n\")
          visibleHeight := m.height - 6 // Account for UI chrome
          maxScroll := len(lines) - visibleHeight
          if maxScroll < 0 {
              maxScroll = 0
          }
          
          if sm.sessionDetailScroll < maxScroll {
              sm.sessionDetailScroll++
          }
      }
  \`\`\`

**Architecture Note**: This fixes the separation of concerns issue where input validation was happening at display layer instead of input layer.

**Finished Result**: Session detail scrolling should stop at the bottom of content, requiring only one 'k' press to scroll back up. Tell the user to test the TUI by viewing a session with long details, scrolling past the bottom with 'j', and verifying it stops at content boundary.

**Commit Instructions**: Commit after implementing the bounds checking with message describing the scrolling fix.

**Testing/Formatting**: If you want to check formatting or run tests, spawn a sub-task with read-only intention and prompt \"Run \`make check test\` and return the pieces of information that are useful to resolving formatting or test issues.\"

**Sub-tasks**: If you want to spawn sub-tasks, only spawn them with read-only intention and be explicit about that fact."


# 4. Message Count Display Fix
"Add message count display to the sessions table using existing NumTurns data.

**Problem**: The sessions table doesn't show conversation length, but this data is already available in sess.Result.NumTurns and displayed in detail view. Users want to see conversation length in the main sessions list like Claude Code's --resume view.

**Available Data**: sess.Result.NumTurns is already loaded in session.Info struct and shown in session detail view (lines 747-750), just needs to be added to main table.

**Required Changes**:
1. Edit \`/Users/allison/humanlayer/humanlayer/humanlayer-tui/sessions.go\`
2. Modify table headers (lines 539-544) to add \"Turns\" column
3. Modify row rendering (lines 595-600) to include turn count
4. Handle cases where sess.Result is nil (incomplete sessions)

**Implementation Details**:

**Header Row (lines 539-544)**:
\`\`\`go
headerRow := centerText(\"Status\", 8) +
    centerText(\"Modified\", 11) +
    centerText(\"Created\", 11) +
    centerText(\"Working Dir\", 20) +
    centerText(\"Model\", 9) +
    centerText(\"Turns\", 6) +  // Add this
    \"Query\"
\`\`\`

**Row Rendering (lines 595-600)**:
\`\`\`go
// Add turn count handling
turnCount := \"-\"
if sess.Result != nil && sess.Result.NumTurns > 0 {
    if sess.Result.NumTurns >= 1000 {
        turnCount = fmt.Sprintf(\"%.1fk\", float64(sess.Result.NumTurns)/1000)
    } else {
        turnCount = fmt.Sprintf(\"%d\", sess.Result.NumTurns)
    }
}

row := centerText(statusIcon, 8) +
    centerText(modifiedTime, 11) +
    centerText(createdTime, 11) +
    leftPadText(workingDir, 20) +
    centerText(modelName, 9) +
    centerText(turnCount, 6) +  // Add this
    queryPreview
\`\`\`

**Nil Handling Pattern**: Follow existing patterns for missing data (like workingDir = \"~\" on line 576).

**Total Width**: Current fixed width is 59 chars, adding 6 chars makes it 65 chars total.

**Finished Result**: The sessions table should show a \"Turns\" column displaying conversation length. Incomplete sessions show \"-\", completed sessions show turn count (with \"k\" abbreviation for 1000+). Tell the user to test the TUI and verify the turn counts appear correctly in the sessions list.

**Commit Instructions**: Commit after adding the turns column with message describing the feature addition.

**Testing/Formatting**: If you want to check formatting or run tests, spawn a sub-task with read-only intention and prompt \"Run \`make check test\` and return the pieces of information that are useful to resolving formatting or test issues.\"

**Sub-tasks**: If you want to spawn sub-tasks, only spawn them with read-only intention and be explicit about that fact."


# 5. Extra Header Text Bug Fix
"Fix the extra header text bug where duplicate/unexpected headers appear above content in all views.

**Problem**: Users see redundant headers like \"Claude Sessions\" appearing above the sessions list, even though the tab bar already provides context. This wastes vertical space and creates visual confusion.

**Root Cause**: Layout responsibility conflict between main layout (tui.go) and sub-view headers. The main layout provides tab bar + separator, but each sub-view adds its own redundant header.

**Current Duplicate Headers**:
- Tab bar shows: \"[1] Approvals    [2] Sessions\"  
- Separator: \"─────────────────────────────\"
- Redundant sub-view header: \"Claude Sessions\" (unnecessary!)
- Actual content: Session list...

**Files with Redundant Headers**:
1. **sessions.go**: \"Claude Sessions\" (line 535), \"Session Details\" (line 638), launch headers (lines 802, 952)
2. **approvals.go**: \"🔐 Approval Request\" (line 388), feedback headers (line 476)  
3. **conversation.go**: Session header via renderHeader (line 373)

**Required Fix**:
Remove the redundant sub-view headers since the main layout tab bar already provides context.

**Implementation Steps**:
1. Edit \`/Users/allison/humanlayer/humanlayer/humanlayer-tui/sessions.go\`:
   - Remove \"Claude Sessions\" header from list view (line 535)
   - Remove \"Session Details\" header from detail view (line 638)
   - Keep launch and modal headers as they're contextually different

2. Edit \`/Users/allison/humanlayer/humanlayer/humanlayer-tui/approvals.go\`:
   - Remove redundant headers from detail and feedback views (lines 388, 476)

3. Edit \`/Users/allison/humanlayer/humanlayer/humanlayer-tui/conversation.go\`:
   - Consider keeping conversation header as it provides session-specific context

**Height Calculation**: Main layout calculates contentHeight = m.height - 3 but doesn't account for sub-view headers, causing overflow. Removing headers will fix this.

**Header Style**: All sub-views use identical styling: Bold(true).Foreground(lipgloss.Color(\"205\")), same as active tab, creating visual confusion.

**Finished Result**: Views should show clean layout with only the tab bar context, no redundant headers. Content should start immediately after the separator line. Tell the user to test the TUI and verify no duplicate headers appear in any view.

**Commit Instructions**: Commit after each file's header removal with messages describing the cleanup.

**Testing/Formatting**: If you want to check formatting or run tests, spawn a sub-task with read-only intention and prompt \"Run \`make check test\` and return the pieces of information that are useful to resolving formatting or test issues.\"

**Sub-tasks**: If you want to spawn sub-tasks, only spawn them with read-only intention and be explicit about that fact."


# 6. Working Directory Inheritance Fix
"Fix the working directory inheritance issue where continued sessions don't inherit parent working directory, implementing a two-part solution.

**Problem**: When resuming a session, the working directory from the parent session is not properly inherited. TUI shows \"~\" instead of actual working directory, and child sessions don't store inherited data.

**Root Cause**: No inheritance mechanism exists. The code assumes Claude CLI preserves working directory on resume (unreliable), but database should store inherited values for TUI display.

**Two-Part Solution Required**:

**PART 1: TUI Instant Display Fix**
- When initiating resume/fork, copy parent model + working dir to local state for instant visual feedback
- File: \`/Users/allison/humanlayer/humanlayer/humanlayer-tui/conversation.go\`

**PART 2: Daemon Database Inheritance Fix**  
- When creating child session, copy parent model + working dir to child session in database
- Files: \`/Users/allison/humanlayer/humanlayer/hld/session/manager.go\`, \`/Users/allison/humanlayer/humanlayer/hld/store/store.go\`

**Implementation Details**:

**PART 1 - TUI Side (conversation.go)**:
Currently the resume handling is around lines 316-320. Modify to store parent data:
\`\`\`go
// When resume is triggered, store parent data for inheritance
if cm.session != nil {
    parentModel := cm.session.Model
    parentWorkingDir := cm.session.WorkingDir
    // Pass this context to continue session somehow
}
\`\`\`

**PART 2 - Daemon Side (session/manager.go lines 504-569)**:
In ContinueSession method, after getting parent session:
\`\`\`go
// Get parent session (already done around line 510)
parentSession, err := m.store.GetSession(req.ParentSessionID)

// Build config with inherited values instead of relying on Claude
config := claudecode.SessionConfig{
    Query:        req.Query,
    SessionID:    parentSession.ClaudeSessionID,
    OutputFormat: claudecode.OutputStreamJSON,
    // INHERIT from parent instead of relying on Claude
    Model:        claudecode.Model(parentSession.Model),
    WorkingDir:   parentSession.WorkingDir,
}

// After creating dbSession from config
dbSession := store.NewSessionFromConfig(sessionID, runID, config)
dbSession.ParentSessionID = req.ParentSessionID
// Explicitly set inherited values for database storage
dbSession.Model = parentSession.Model
dbSession.WorkingDir = parentSession.WorkingDir
\`\`\`

**Key Insight**: 
- Claude Code level: Still inherits automatically via --resume flag  
- HumanLayer daemon level: Should store inherited values in database for TUI display
- TUI level: Should show inherited values immediately when initiating resume

**Current Session Continuation Flow**:
1. TUI conversation.go calls continueSession API
2. API calls daemon ContinueSession RPC  
3. Daemon gets parent session but doesn't copy model/working dir
4. NewSessionFromConfig creates child without inheritance
5. TUI displays child session with default values

**Database Schema**: Sessions table already has model and working_dir columns, just need to populate them with parent values.

**Finished Result**: When resuming a session, both the model and working directory should be inherited from the parent and displayed correctly in the TUI. The child session in the database should store these inherited values. Tell the user to test the TUI by resuming a session and verifying the working directory and model are inherited properly.

**Commit Instructions**: 
- Commit after PART 1 (TUI changes) with message about TUI inheritance display
- Commit after PART 2 (daemon changes) with message about database inheritance storage

**Testing/Formatting**: If you want to check formatting or run tests, spawn a sub-task with read-only intention and prompt \"Run \`make check test\` and return the pieces of information that are useful to resolving formatting or test issues.\"

**Sub-tasks**: If you want to spawn sub-tasks, only spawn them with read-only intention and be explicit about that fact."

)

# Function to launch agent in existing worktree
launch_agent_in_worktree() {
    local task_name="$1"
    local prompt="$2"
    local worktree_name="tui_${task_name}"
    local worktree_path="${WORKTREES_BASE}/${REPO_BASE_NAME}_${worktree_name}"
    
    # Check if worktree exists
    if [ ! -d "$worktree_path" ]; then
        echo "❌ Worktree does not exist: ${worktree_path}"
        echo "   Run hack/create_worktrees.sh first to create worktrees"
        return 1
    fi
    
    echo "🚀 Launching agent in: ${worktree_path}"
    
    # Change to worktree directory and launch agent
    cd "$worktree_path"
    
    # Launch humanlayer with the prompt (using npm link)
    if ! humanlayer launch "$prompt" --model opus; then
        echo "❌ Failed to launch agent for ${task_name}"
        cd - > /dev/null
        return 1
    fi
    
    cd - > /dev/null
    echo "✅ Agent launched for: ${task_name}"
}

# Function to check if worktrees exist
check_worktrees() {
    local missing_worktrees=()
    
    for task_name in "${TASK_NAMES[@]}"; do
        local worktree_name="tui_${task_name}"
        local worktree_path="${WORKTREES_BASE}/${REPO_BASE_NAME}_${worktree_name}"
        
        if [ ! -d "$worktree_path" ]; then
            missing_worktrees+=("$task_name")
        fi
    done
    
    if [ ${#missing_worktrees[@]} -gt 0 ]; then
        echo "❌ Missing worktrees for the following tasks:"
        for task_name in "${missing_worktrees[@]}"; do
            echo "   ${task_name}"
        done
        echo ""
        echo "Please run hack/create_worktrees.sh first to create the worktrees."
        exit 1
    fi
}

# Main execution
echo "🚀 Launching 6 TUI fix agents sequentially in existing worktrees..."
echo "📁 Looking for worktrees in: ${WORKTREES_BASE}"
echo ""

# Check that all required worktrees exist
check_worktrees

echo "✅ All required worktrees found. Starting agent launches..."

SUCCESSFUL_LAUNCHES=()
FAILED_LAUNCHES=()

# Launch agents sequentially
for i in "${!TASK_NAMES[@]}"; do
    task_name="${TASK_NAMES[$i]}"
    prompt="${AGENT_PROMPTS[$i]}"
    
    echo ""
    echo "========================================"
    echo "Starting task $((i+1))/6: ${task_name}"
    echo "========================================"
    
    # Launch each agent sequentially 
    if launch_agent_in_worktree "$task_name" "$prompt"; then
        SUCCESSFUL_LAUNCHES+=("$task_name")
    else
        FAILED_LAUNCHES+=("$task_name")
        echo "❌ Task ${task_name} failed, but continuing with remaining tasks..."
    fi
done

echo ""
echo "========================================"
echo "Agent Launch Summary"
echo "========================================"

if [ ${#SUCCESSFUL_LAUNCHES[@]} -gt 0 ]; then
    echo "✅ Successfully launched ${#SUCCESSFUL_LAUNCHES[@]} agents:"
    for task_name in "${SUCCESSFUL_LAUNCHES[@]}"; do
        echo "   ${task_name}"
    done
fi

if [ ${#FAILED_LAUNCHES[@]} -gt 0 ]; then
    echo ""
    echo "❌ Failed to launch ${#FAILED_LAUNCHES[@]} agents:"
    for task_name in "${FAILED_LAUNCHES[@]}"; do
        echo "   ${task_name}"
    done
fi
echo "📁 Worktree locations:"

for task_name in "${TASK_NAMES[@]}"; do
    worktree_name="tui_${task_name}"
    echo "   ${WORKTREES_BASE}/${REPO_BASE_NAME}_${worktree_name}"
done

echo ""
echo "To monitor progress, you can:"
echo "   - Check individual worktree directories"
echo "   - Use 'git worktree list' to see all active worktrees"
echo "   - Each agent ran sequentially to avoid resource conflicts"
