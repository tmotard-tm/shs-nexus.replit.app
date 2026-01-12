import { storage } from "./storage";
import bcrypt from "bcrypt";

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

  for (const userData of testUsers) {
    try {
      // Check if user already exists
      const existingUsers = await storage.getUsers();
      const exists = existingUsers.some(u => u.username === userData.username || u.email === userData.email);
      
      if (!exists) {
        // Hash password
        const hashedPassword = await bcrypt.hash(userData.password, 10);
        
        await storage.createUser({
          username: userData.username,
          email: userData.email,
          password: hashedPassword,
          role: userData.role,
          departments: userData.departments
        });
        
        console.log(`Created test user: ${userData.username} (${userData.role})`);
      } else {
        console.log(`User ${userData.username} already exists, skipping...`);
      }
    } catch (error) {
      console.error(`Failed to create user ${userData.username}:`, error);
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
