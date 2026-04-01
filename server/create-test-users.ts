import { storage } from "./storage";
import bcrypt from "bcrypt";
import type { StoredSecurityQuestion } from "../shared/schema";

const TEST_SECURITY_QUESTIONS: Array<{ questionId: string; questionText: string; answer: string }> = [
  { questionId: "q1", questionText: "What is the name of your first pet?", answer: "testanswer" },
  { questionId: "q2", questionText: "What city were you born in?", answer: "testanswer" },
  { questionId: "q3", questionText: "What is your mother's maiden name?", answer: "testanswer" },
];

async function buildSecurityQuestions(): Promise<StoredSecurityQuestion[]> {
  return Promise.all(
    TEST_SECURITY_QUESTIONS.map(async (q) => ({
      questionId: q.questionId,
      questionText: q.questionText,
      answerHash: await bcrypt.hash(q.answer.toLowerCase(), 10),
    }))
  );
}

// Create sample users for testing - simplified to just developer and agent roles
export async function createTestUsers() {
  console.log("Creating test users for role-based access control testing...");

  const testUsers = [
    {
      username: "assets_agent",
      email: "assets@test.com",
      password: "test123",
      role: "agent",
      departments: ["ASSETS"]
    },
    {
      username: "fleet_agent",
      email: "fleet@test.com", 
      password: "test123",
      role: "agent",
      departments: ["FLEET"]
    },
    {
      username: "inventory_agent",
      email: "inventory@test.com",
      password: "test123", 
      role: "agent",
      departments: ["INVENTORY"]
    },
    {
      username: "ntao_agent",
      email: "ntao@test.com",
      password: "test123",
      role: "agent", 
      departments: ["NTAO"]
    },
    {
      username: "multi_dept_agent",
      email: "multi@test.com",
      password: "test123",
      role: "agent",
      departments: ["NTAO", "ASSETS"]
    },
    {
      username: "developer",
      email: "admin@test.com", 
      password: "test123",
      role: "developer",
      departments: ["NTAO", "ASSETS", "INVENTORY", "FLEET"]
    }
  ];

  const prebuiltSecurityQuestions = await buildSecurityQuestions();

  for (const userData of testUsers) {
    try {
      const existingUsers = await storage.getUsers();
      const existingUser = existingUsers.find(u => u.username === userData.username || u.email === userData.email);
      
      if (!existingUser) {
        const hashedPassword = await bcrypt.hash(userData.password, 10);
        
        const newUser = await storage.createUser({
          username: userData.username,
          email: userData.email,
          password: hashedPassword,
          role: userData.role,
          departments: userData.departments
        });
        
        await storage.updateUser(newUser.id, { securityQuestions: prebuiltSecurityQuestions });
        console.log(`Created test user: ${userData.username} (${userData.role})`);
      } else {
        const sq = existingUser.securityQuestions as StoredSecurityQuestion[] | null;
        if (!sq || sq.length < 3) {
          await storage.updateUser(existingUser.id, { securityQuestions: prebuiltSecurityQuestions });
          console.log(`Seeded security questions for existing test user: ${userData.username}`);
        } else {
          console.log(`User ${userData.username} already exists with security questions, skipping...`);
        }
      }
    } catch (error) {
      console.error(`Failed to create/update user ${userData.username}:`, error);
    }
  }

  console.log("Test user creation complete!");
  console.log("\nTest User Credentials:");
  console.log("- assets_agent / test123 (Agent with Assets access)");
  console.log("- fleet_agent / test123 (Agent with Fleet access)");
  console.log("- inventory_agent / test123 (Agent with Inventory access)");
  console.log("- ntao_agent / test123 (Agent with NTAO access)"); 
  console.log("- multi_dept_agent / test123 (Agent with NTAO + Assets access)");
  console.log("- developer / test123 (Super Admin with all access)");
}
