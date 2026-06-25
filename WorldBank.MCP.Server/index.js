import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Octokit } from "octokit";
import fs from "fs/promises";
import path from "path";

// 🎯 CONFIGURATION: Point this to where your local TestResults folder lives!
const TEST_RESULTS_DIR = "C:\\actions-runner\\_work\\WorldBank-Core-Automation-Playwrite\\WorldBank-Core-Automation-Playwrite\\TestResults";

// Initialize GitHub Client using the token we will pass from Claude
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const server = new Server(
  { name: "WorldBank-Triage-Agent", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// 1. Tell Claude what tools are available
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "read_test_artifact",
        description: "Reads the content of a local test artifact (.trx, .md, or .playlist) from the WorldBank TestResults directory.",
        inputSchema: {
          type: "object",
          properties: {
            filename: { type: "string", description: "The exact name of the file to read (e.g., TestResults.trx or FailedTests.playlist)" }
          },
          required: ["filename"]
        }
      },
      {
        name: "search_github_issues",
        description: "Searches open GitHub issues in the WorldBank repository to check for known bugs.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Keywords to search for (e.g., 'Timeout recipient-select')" }
          },
          required: ["query"]
        }
      }
    ]
  };
});

// 2. Execute the tools when Claude asks to use them
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "read_test_artifact") {
    try {
      const safePath = path.join(TEST_RESULTS_DIR, request.params.arguments.filename);
      
      // Security Check: Prevent directory traversal attacks
      if (!safePath.startsWith(TEST_RESULTS_DIR)) {
         throw new Error("Security Violation: Attempted to read outside TestResults directory.");
      }

      const content = await fs.readFile(safePath, "utf-8");
      return { content: [{ type: "text", text: content }] };
    } catch (error) {
      return { content: [{ type: "text", text: `Error reading file: ${error.message}` }], isError: true };
    }
  }

  if (request.params.name === "search_github_issues") {
    try {
      // 🎯 CONFIGURATION: Ensure this matches your actual repository
      const q = `${request.params.arguments.query} repo:ViktorVakareev/WorldBank-Core-Automation-Playwrite is:issue is:open`;
      const response = await octokit.rest.search.issuesAndPullRequests({ q });
      
      const formattedIssues = response.data.items.map(issue => 
        `Issue #${issue.number}: ${issue.title}\nState: ${issue.state}\nURL: ${issue.html_url}`
      ).join("\n\n");

      return { content: [{ type: "text", text: formattedIssues || "No known issues found matching that query." }] };
    } catch (error) {
      return { content: [{ type: "text", text: `GitHub API Error: ${error.message}` }], isError: true };
    }
  }

  throw new Error("Tool not found");
});

// 3. Connect the server via Standard I/O (How Claude talks to it)
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("WorldBank MCP Server is active and listening...");