import { SnowflakeService } from './snowflake-service';

async function testQuery() {
  try {
    const config = {
      account: process.env.SNOWFLAKE_ACCOUNT || '',
      username: process.env.SNOWFLAKE_USER || '',
      privateKey: process.env.SNOWFLAKE_PRIVATE_KEY || '',
      database: 'PRD_TECH_RECRUITMENT',
      schema: 'FLEET_DETAILS',
      warehouse: process.env.SNOWFLAKE_WAREHOUSE || 'SCIENTIST_PRD_WH',
    };
    
    const snowflake = new SnowflakeService(config);
    await snowflake.connect();
    
    // Check records with dates
    console.log('=== RECORDS WITH SEPARATION DATES ===\n');
    const datesQuery = `
      SELECT LDAP_ID, TECHNICIAN_NAME, EMPLID, LAST_DAY, EFFECTIVE_SEPARATION_DATE, TRUCK_NUMBER, SEPARATION_CATEGORY
      FROM PRD_TECH_RECRUITMENT.FLEET_DETAILS.SEPARATION_FLEET_DETAILS 
      WHERE LAST_DAY IS NOT NULL OR EFFECTIVE_SEPARATION_DATE IS NOT NULL
      LIMIT 10
    `;
    const withDates = await snowflake.executeQuery(datesQuery);
    console.log('Records with dates:', JSON.stringify(withDates, null, 2));
    
    // Check how many have each field
    console.log('\n=== FIELD POPULATION ===');
    const statsQuery = `
      SELECT 
        COUNT(*) as TOTAL,
        COUNT(LAST_DAY) as HAS_LAST_DAY,
        COUNT(EFFECTIVE_SEPARATION_DATE) as HAS_EFF_SEP_DATE,
        COUNT(TRUCK_NUMBER) as HAS_TRUCK,
        COUNT(CONTACT_NUMBER) as HAS_CONTACT,
        COUNT(PERSONAL_EMAIL) as HAS_EMAIL
      FROM PRD_TECH_RECRUITMENT.FLEET_DETAILS.SEPARATION_FLEET_DETAILS
    `;
    const stats = await snowflake.executeQuery(statsQuery);
    console.log(JSON.stringify(stats, null, 2));
    
  } catch (error: any) {
    console.error('Error:', error.message);
  }
  process.exit(0);
}

testQuery();
