import { storage } from "./storage";
import bcrypt from "bcrypt";

// Create sample users for each role type for testing
export async function createTestUsers() {
  console.log("Creating test users for role-based access control testing...");

  const testUsers = [
    {
      username: "assets_user",
      email: "assets@test.com",
      password: "test123",
      role: "assets",
      department: "ASSETS",
      departmentAccess: ["ASSETS"]
    },
    {
      username: "fleet_user",
      email: "fleet@test.com", 
      password: "test123",
      role: "fleet",
      department: "FLEET",
      departmentAccess: ["FLEET"]
    },
    {
      username: "inventory_user",
      email: "inventory@test.com",
      password: "test123", 
      role: "inventory",
      department: "INVENTORY",
      departmentAccess: ["INVENTORY"]
    },
    {
      username: "ntao_user",
      email: "ntao@test.com",
      password: "test123",
      role: "ntao", 
      department: "NTAO",
      departmentAccess: ["NTAO"]
    },
    {
      username: "field_user",
      email: "field@test.com",
      password: "test123",
      role: "field",
      department: null,
      departmentAccess: []
    },
    {
      username: "superadmin",
      email: "admin@test.com", 
      password: "test123",
      role: "superadmin",
      department: null,
      departmentAccess: ["NTAO", "ASSETS", "INVENTORY", "FLEET"]
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
          department: userData.department,
          departmentAccess: userData.departmentAccess
        });
        
        console.log(`✅ Created test user: ${userData.username} (${userData.role})`);
      } else {
        console.log(`⏭️  User ${userData.username} already exists, skipping...`);
      }
    } catch (error) {
      console.error(`❌ Failed to create user ${userData.username}:`, error);
    }
  }

  console.log("Test user creation complete!");
  console.log("\nTest User Credentials:");
  console.log("- assets_user / test123 (Assets role)");
  console.log("- fleet_user / test123 (Fleet role)");
  console.log("- inventory_user / test123 (Inventory role)");
  console.log("- ntao_user / test123 (NTAO role)"); 
  console.log("- field_user / test123 (Field role)");
  console.log("- superadmin / test123 (Super Admin role)");
}