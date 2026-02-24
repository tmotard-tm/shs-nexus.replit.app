// SAML SSO INTEGRATION
import { Strategy as SamlStrategy, type SamlConfig } from "@node-saml/passport-saml";
import { storage } from "./storage";

const IDP_CERT = `MIIEETCCAvmgAwIBAgIJAJ77RDuevC3xMA0GCSqGSIb3DQEBCwUAMIGeMQswCQYDVQQGEwJVUzELMAkGA1UECAwCSUwxGDAWBgNVBAcMD0hPRkZNQU4gRVNUQVRFUzEdMBsGA1UECgwUU0VBUlMgSE9MRElOR1MgQ09SUC4xDDAKBgNVBAsMA1NTTzEYMBYGA1UEAwwPc3NvLnNlYXJzaGMuY29tMSEwHwYJKoZIhvcNAQkBFhJ3ZWJhZG1Ac2VhcnNoYy5jb20wHhcNMTcwNDA1MTgxNzE3WhcNMzcwMzMxMTgxNzE3WjCBnjELMAkGA1UEBhMCVVMxCzAJBgNVBAgMAklMMRgwFgYDVQQHDA9IT0ZGTUFOIEVTVEFURVMxHTAbBgNVBAoMFFNFQVJTIEhPTERJTkdTIENPUlAuMQwwCgYDVQQLDANTU08xGDAWBgNVBAMMD3Nzby5zZWFyc2hjLmNvbTEhMB8GCSqGSIb3DQEJARYSd2ViYWRtQHNlYXJzaGMuY29tMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnWgxPG2Kd8eO/UhMaSA9GR4IkJNaAIln59NatIcGBWuTmhcay3QGrgiw71CSumMSnIYawKw2YDworsQi1K9ep3+4y9qs4QgcohkFc/WgnEblgkqghbHUUldb8Pt9pxixihPQ1Rdh9lxzZhP6iTS7SpIJlUmy60g6OpMwxHcXKA7sjoiD6DT5+lo4jxk6Y1aWgvnnDGHgstzNhldn1SH8rmbuUkXKGbe9VBovWnSYbyh7G5iI3zW8AUmiqzxK+epHYPXedjSGTmaaX/s2w4jwSnVOr01lflL24P6P+9WISzBKueLdLAtebQMvfZibtBct2BgDGZYO/NNj/w1BPrENVwIDAQABo1AwTjAdBgNVHQ4EFgQUisDlFxO8bxq2P0qBSpoM2Atwn5IwHwYDVR0jBBgwFoAUisDlFxO8bxq2P0qBSpoM2Atwn5IwDAYDVR0TBAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAl/qf37LuAgLFczr8OdMkImXkyFbaqKq2gP0idsdJdyiOTc/ReridZaflguBt4i/AKNqtLtYSGnSjLGWQvU+XcPHYhFACmoIb+G/i6h33a8kMqQ7RPXVuQm+/UFSnS0rUPVmh3bpzSvtnyXyJjiQUcTAE+oQAgO9kUSLqylgtp3QYvvfGx++7XZuO4rPRCEMzDON+1qiCan2XUgIM6NIpIJaFCuAqW44GczU5Y73mXKniDG2d/BS0Berlqt2FOdLraF9sKc2qODH9+gjwg31fWXTENHNBZljmyIWcOAPD0Qy9Rrjry6hRS344QKqpveUyik1Im8EAs5iFzUFaren3TQ==`;

const IDP_ENTITY_ID = "sso.searshc.com/nexus";
const IDP_SSO_URL = "https://sso.searshc.com/idp-nexus/saml2/idp/SSOService.php";
const IDP_SLO_URL = "https://sso.searshc.com/idp-nexus/saml2/idp/initSLO.php";

export function getBaseUrl(): string {
  if (process.env.SAML_BASE_URL) {
    return process.env.SAML_BASE_URL;
  }
  if (process.env.REPLIT_DOMAINS) {
    return `https://${process.env.REPLIT_DOMAINS.split(',')[0]}`;
  }
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }
  return 'https://localhost:5000';
}

export function getSamlConfig(): SamlConfig {
  const baseUrl = getBaseUrl();
  const callbackUrl = `${baseUrl}/auth/saml/acs`;
  const entityId = process.env.SAML_SP_ENTITY_ID || `${baseUrl}/auth/saml/metadata`;

  return {
    callbackUrl,
    entryPoint: IDP_SSO_URL,
    issuer: entityId,
    idpCert: IDP_CERT,
    logoutUrl: IDP_SLO_URL,
    identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified",
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    acceptedClockSkewMs: 5 * 60 * 1000,
    disableRequestedAuthnContext: true,
  };
}

export function createSamlStrategy() {
  const config = getSamlConfig();

  return new SamlStrategy(
    config,
    async (profile: any, done: any) => {
      try {
        const nameID = profile.nameID;
        const uid = profile.uid || profile["urn:oid:0.9.2342.19200300.100.1.1"] || nameID;
        const enterpriseId = (uid || "").toString().trim().toLowerCase();

        console.log(`[SAML SSO] Authentication attempt for NameID: ${nameID}, uid: ${uid}, resolved enterpriseId: ${enterpriseId}`);

        if (!enterpriseId) {
          console.error("[SAML SSO] No enterprise ID found in SAML assertion");
          return done(null, false, { message: "No enterprise ID found in SAML assertion" });
        }

        const user = await storage.getUserByUsername(enterpriseId);

        if (!user) {
          console.warn(`[SAML SSO] User not found for enterprise ID: ${enterpriseId}`);
          return done(null, false, { message: `User "${enterpriseId}" not found in application. Please contact application administrator.` });
        }

        if (!user.isActive) {
          console.warn(`[SAML SSO] Deactivated user attempted SSO: ${enterpriseId}`);
          return done(null, false, { message: "Your account has been deactivated. Please contact an administrator." });
        }

        console.log(`[SAML SSO] Successfully authenticated user: ${user.username} (role: ${user.role})`);

        await storage.createActivityLog({
          userId: user.id,
          action: "sso_login_success",
          entityType: "auth",
          entityId: user.id,
          details: `User "${user.username}" (role: ${user.role}) authenticated via SAML SSO`,
        });

        return done(null, user);
      } catch (error) {
        console.error("[SAML SSO] Error processing SAML assertion:", error);
        return done(error);
      }
    },
    async (profile: any, done: any) => {
      return done(null, profile);
    }
  );
}

export function generateSpMetadata(strategy: SamlStrategy): string {
  const config = getSamlConfig();
  const baseUrl = getBaseUrl();
  const entityId = config.issuer;
  const acsUrl = config.callbackUrl;

  return `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${entityId}">
  <md:SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol" AuthnRequestsSigned="false" WantAssertionsSigned="true">
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified</md:NameIDFormat>
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${acsUrl}" index="1" isDefault="true"/>
    <md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${baseUrl}/auth/logout"/>
  </md:SPSSODescriptor>
  <md:ContactPerson contactType="technical">
    <md:GivenName>SHS Nexus</md:GivenName>
    <md:EmailAddress>webadm@searshc.com</md:EmailAddress>
  </md:ContactPerson>
</md:EntityDescriptor>`;
}

export function printSpDetails(): void {
  const config = getSamlConfig();
  const baseUrl = getBaseUrl();

  console.log("\n================================================");
  console.log("SAML SERVICE PROVIDER DETAILS");
  console.log("=============================");
  console.log(`1. ACS URL: ${config.callbackUrl}`);
  console.log(`2. Entity ID: ${config.issuer}`);
  console.log(`3. Relay State URL: ${baseUrl}`);
  console.log("4. NameID: uid (enterprise id)");
  console.log("5. NameID Format: urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified");
  console.log(`6. Metadata URL: ${baseUrl}/auth/saml/metadata`);
  console.log(`7. IdP SSO URL: ${IDP_SSO_URL}`);
  console.log(`8. IdP SLO URL: ${IDP_SLO_URL}`);
  console.log(`9. IdP Entity ID: ${IDP_ENTITY_ID}`);
  console.log("================================================\n");
}
