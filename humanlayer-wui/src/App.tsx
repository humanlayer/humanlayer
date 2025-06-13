
import { useState, useEffect } from "react";
import { daemonClient } from "./daemon-client";
import "./App.css";

function App() {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("");
  const [sessions, setSessions] = useState<any[]>([]);
  const [approvals, setApprovals] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Connect to daemon on mount
  useEffect(() => {
    connectToDaemon();
  }, []);

  async function connectToDaemon() {
    try {
      setStatus("Connecting to daemon...");
      await daemonClient.connect();
      setConnected(true);
      setStatus("Connected!");

      // Check health
      const health = await daemonClient.health();
      setStatus(`Connected! Daemon version: ${health.version}`);

      // Load sessions
      await loadSessions();
    } catch (error) {
      setStatus(`Failed to connect: ${error}`);
      setConnected(false);
    }
  }

  async function loadSessions() {
    try {
      const response = await daemonClient.listSessions();
      setSessions(response.sessions);
    } catch (error) {
      console.error("Failed to load sessions:", error);
    }
  }

  async function launchSession() {
    if (!query.trim()) {
      alert("Please enter a query");
      return;
    }

    try {
      setStatus("Launching session...");
      const response = await daemonClient.launchSession({
        query: query.trim(),
        model: "sonnet",
        verbose: true,
      });

      setActiveSessionId(response.session_id);
      setStatus(`Session launched! ID: ${response.session_id}`);

      // Subscribe to events
      const unsubscribe = await daemonClient.subscribeToEvents({
        session_id: response.session_id,
      });

      // Refresh sessions list
      await loadSessions();

      // Start polling for approvals
      pollForApprovals(response.session_id);
    } catch (error) {
      setStatus(`Failed to launch session: ${error}`);
    }
  }

  async function pollForApprovals(sessionId: string) {
    const interval = setInterval(async () => {
      try {
        const response = await daemonClient.fetchApprovals(sessionId);
        setApprovals(response.approvals);

        // Check session status
        const sessionState = await daemonClient.getSessionState(sessionId);
        if (
          sessionState.session.status === "completed" ||
          sessionState.session.status === "failed"
        ) {
          clearInterval(interval);
          setStatus(`Session ${sessionState.session.status}`);
          await loadSessions();
        }
      } catch (error) {
        console.error("Failed to fetch approvals:", error);
      }
    }, 2000);
  }

  async function handleApproval(approval: any, approved: boolean) {
    try {
      if (approval.type === "function_call" && approval.function_call) {
        if (approved) {
          await daemonClient.approveFunctionCall(
            approval.function_call.call_id,
            "Approved via UI",
          );
        } else {
          await daemonClient.denyFunctionCall(
            approval.function_call.call_id,
            "Denied via UI",
          );
        }
      } else if (approval.type === "human_contact" && approval.human_contact) {
        const response = prompt("Enter your response:");
        if (response) {
          await daemonClient.respondToHumanContact(
            approval.human_contact.call_id,
            response,
          );
        }
      }

      // Refresh approvals
      if (activeSessionId) {
        const response = await daemonClient.fetchApprovals(activeSessionId);
        setApprovals(response.approvals);
      }
    } catch (error) {
      alert(`Failed to handle approval: ${error}`);
    }
  }

  return (
    <main className="container">
      <h1>HumanLayer Daemon Client Test</h1>

      <div style={{ marginBottom: "20px" }}>
        <strong>Status:</strong> {status}
        {!connected && (
          <button onClick={connectToDaemon} style={{ marginLeft: "10px" }}>
            Retry Connection
          </button>
        )}
      </div>

      {connected && (
        <>
          <div style={{ marginBottom: "20px" }}>
            <h2>Launch New Session</h2>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Enter your query..."
              style={{ width: "300px", marginRight: "10px" }}
            />
            <button onClick={launchSession}>Launch Session</button>
          </div>

          <div style={{ marginBottom: "20px" }}>
            <h2>Sessions ({sessions.length})</h2>
            <div
              style={{
                maxHeight: "200px",
                overflow: "auto",
                border: "1px solid #ccc",
                padding: "10px",
              }}
            >
              {sessions.map((session) => (
                <div
                  key={session.id}
                  style={{
                    marginBottom: "10px",
                    padding: "5px",
                    background: "#f0f0f0",
                  }}
                >
                  <strong>{session.query}</strong>
                  <br />
                  ID: {session.id}
                  <br />
                  Status: {session.status}
                  <br />
                  Started: {new Date(session.start_time).toLocaleString()}
                </div>
              ))}
            </div>
            <button onClick={loadSessions} style={{ marginTop: "10px" }}>
              Refresh Sessions
            </button>
          </div>

          {approvals.length > 0 && (
            <div>
              <h2>Pending Approvals ({approvals.length})</h2>
              {approvals.map((approval, index) => (
                <div
                  key={index}
                  style={{
                    marginBottom: "10px",
                    padding: "10px",
                    border: "1px solid #ff6600",
                  }}
                >
                  <strong>Type:</strong> {approval.type}
                  <br />
                  {approval.function_call && (
                    <>
                      <strong>Function:</strong>{" "}
                      {approval.function_call.spec.fn}
                      <br />
                      <strong>Args:</strong>{" "}
                      {JSON.stringify(approval.function_call.spec.kwargs)}
                      <br />
                      <button
                        onClick={() => handleApproval(approval, true)}
                        style={{ marginRight: "5px" }}
                      >
                        Approve
                      </button>
                      <button onClick={() => handleApproval(approval, false)}>
                        Deny
                      </button>
                    </>
                  )}
                  {approval.human_contact && (
                    <>
                      <strong>Message:</strong>{" "}
                      {approval.human_contact.spec.msg}
                      <br />
                      <button onClick={() => handleApproval(approval, true)}>
                        Respond
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  )
}

export default App
