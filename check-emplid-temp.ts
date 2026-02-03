import { getSnowflakeService, isSnowflakeConfigured } from './server/snowflake-service';

async function main() {
  if (!isSnowflakeConfigured()) {
    console.error('Snowflake not configured');
    process.exit(1);
  }
  
  const snowflake = getSnowflakeService();
  
  console.log('=== Checking EMPLID formats ===\n');

  console.log('1. Sample EMPL_ID from TECHNICIAN_ROSTER_VW:');
  const rosterRows = await snowflake.executeQuery(`
    SELECT EMPL_ID, ENTERPRISE_ID, TECH_NAME 
    FROM PRD_TECH_RECRUITMENT.BACH_VIEWS.TECHNICIAN_ROSTER_VW 
    WHERE EMPL_ID IS NOT NULL 
    LIMIT 5
  `);
  console.log(JSON.stringify(rosterRows, null, 2));

  console.log('\n2. Sample EMPLID from ORA_TECH_LAST_KNOWN_CONTACT_VW_VIEW:');
  const contactRows = await snowflake.executeQuery(`
    SELECT EMPLID, SNSTV_CELL_PHONE, SNSTV_HOME_CITY 
    FROM PRD_TECH_RECRUITMENT.BACH_VIEWS.ORA_TECH_LAST_KNOWN_CONTACT_VW_VIEW 
    WHERE EMPLID IS NOT NULL 
    LIMIT 5
  `);
  console.log(JSON.stringify(contactRows, null, 2));

  console.log('\n3. Checking if any EMPL_ID matches EMPLID (direct join):');
  const matchRows = await snowflake.executeQuery(`
    SELECT COUNT(*) as MATCH_COUNT
    FROM PRD_TECH_RECRUITMENT.BACH_VIEWS.TECHNICIAN_ROSTER_VW t
    INNER JOIN PRD_TECH_RECRUITMENT.BACH_VIEWS.ORA_TECH_LAST_KNOWN_CONTACT_VW_VIEW c
      ON t.EMPL_ID = c.EMPLID
  `);
  console.log(JSON.stringify(matchRows, null, 2));

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
