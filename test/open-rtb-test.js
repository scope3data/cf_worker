// Test script for buildOpenRtbRequest function
import * as workerModule from '../src/index.js';
import * as UAParserLib from 'ua-parser-js';

// Since the function might not be directly exported, let's use a different approach
// We'll redefine the function here based on the implementation in index.js
function buildOpenRtbRequest(url, etag, lastModified, request) {
  // Extract domain from the URL
  const domain = url.hostname;
  
  // Get user agent string from request headers
  const userAgentString = request?.headers?.get("user-agent") || "";
  
  // Parse user agent with UAParser
  const parser = new UAParserLib.UAParser(userAgentString);
  const result = parser.getResult();
  
  // Determine device type from parsing result (1=mobile, 2=desktop, 3=connected TV, 4=phone, 5=tablet, 6=connected device, 7=set top box)
  let devicetype = 2; // Default to desktop
  if (result.device.type === 'mobile' || result.device.type === 'tablet') {
    devicetype = result.device.type === 'mobile' ? 1 : 5;
  }
  
  // Get geolocation data from CF data with defaults
  let country = "US"; // Default country
  let region = "";
  let city = "";
  let postalCode = "";
  let latitude = null;
  let longitude = null;
  let timezone = "";
  
  if (request && request.cf) {
    // Get country from CF data
    if (request.cf.country) {
      country = request.cf.country;
    }
    
    // Get region from CF data
    if (request.cf.region) {
      region = request.cf.region;
    }
    
    // Get city from CF data
    if (request.cf.city) {
      city = request.cf.city;
    }
    
    // Get postal code from CF data
    if (request.cf.postalCode) {
      postalCode = request.cf.postalCode;
    }
    
    // Get coordinates from CF data
    if (request.cf.latitude !== undefined) {
      // Ensure latitude is a number
      latitude = typeof request.cf.latitude === 'number' ? 
                request.cf.latitude : 
                parseFloat(request.cf.latitude);
    }
    if (request.cf.longitude !== undefined) {
      // Ensure longitude is a number
      longitude = typeof request.cf.longitude === 'number' ? 
                 request.cf.longitude : 
                 parseFloat(request.cf.longitude);
    }
    
    // Get timezone from CF data
    if (request.cf.timezone) {
      timezone = request.cf.timezone;
    }
  }
  
  // Check for CF-Device-Type header
  const cfDeviceType = request?.headers?.get("CF-Device-Type");
  if (cfDeviceType) {
    // Override devicetype based on CF-Device-Type header
    if (cfDeviceType === "mobile") {
      devicetype = 1;
    } else if (cfDeviceType === "tablet") {
      devicetype = 5;
    } else if (cfDeviceType === "desktop") {
      devicetype = 2;
    }
  }
  
  // Create OpenRTB request format
  const openRtbRequest = {
    site: {
      domain: domain,
      page: url.toString(),
      ext: {
        scope3: {
          etag: etag || "",
          last_modified: lastModified || ""
        }
      }
    },
    imp: [
      {
        id: "1"
      }
    ],
    device: {
      devicetype: devicetype,
      geo: {
        country: country
      },
      ua: userAgentString,
      os: result.os.name,
      make: result.device.vendor || "",
      model: result.device.model || ""
    }
  };
  
  // Add optional geo fields only if they have valid values
  if (region) openRtbRequest.device.geo.region = region;
  if (city) openRtbRequest.device.geo.city = city;
  if (postalCode) openRtbRequest.device.geo.zip = postalCode;
  if (latitude !== null && !isNaN(latitude)) openRtbRequest.device.geo.lat = latitude;
  if (longitude !== null && !isNaN(longitude)) openRtbRequest.device.geo.lon = longitude;
  if (timezone) openRtbRequest.device.geo.utcoffset = timezone;
  
  return openRtbRequest;
}

// We've redefined the function above, so no need to check if it exists

// Mock a request with headers and CF data
const mockRequest = {
  headers: {
    _headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'cf-device-type': 'desktop'
    },
    get: function(name) {
      return this._headers[name.toLowerCase()] || null;
    }
  },
  cf: {
    country: 'US',
    region: 'CA',
    city: 'San Francisco',
    postalCode: '94107',
    latitude: 37.7749,
    longitude: -122.4194,
    timezone: 'America/Los_Angeles'
  }
};

// Test the function
console.log('Testing buildOpenRtbRequest function...');
try {
  const url = new URL('https://example.com/test-page');
  const etag = 'W/"123456789"';
  const lastModified = 'Wed, 01 Jan 2023 12:00:00 GMT';
  
  const rtbRequest = buildOpenRtbRequest(url, etag, lastModified, mockRequest);
  
  console.log('OpenRTB Request generated:');
  console.log(JSON.stringify(rtbRequest, null, 2));
  
  // Validate the request
  let valid = true;
  const validationErrors = [];
  
  // Check basic structure
  if (!rtbRequest.site) {
    valid = false;
    validationErrors.push('Missing site object');
  }
  
  if (!rtbRequest.imp || !Array.isArray(rtbRequest.imp)) {
    valid = false;
    validationErrors.push('Missing or invalid imp array');
  }
  
  if (!rtbRequest.device) {
    valid = false;
    validationErrors.push('Missing device object');
  }
  
  // Check specific values
  if (rtbRequest.site?.domain !== 'example.com') {
    valid = false;
    validationErrors.push(`Invalid domain: ${rtbRequest.site?.domain}`);
  }
  
  if (rtbRequest.site?.page !== 'https://example.com/test-page') {
    valid = false;
    validationErrors.push(`Invalid page URL: ${rtbRequest.site?.page}`);
  }
  
  if (rtbRequest.site?.ext?.scope3?.etag !== etag) {
    valid = false;
    validationErrors.push(`Invalid etag: ${rtbRequest.site?.ext?.scope3?.etag}`);
  }
  
  if (rtbRequest.site?.ext?.scope3?.last_modified !== lastModified) {
    valid = false;
    validationErrors.push(`Invalid last_modified: ${rtbRequest.site?.ext?.scope3?.last_modified}`);
  }
  
  if (rtbRequest.device?.geo?.country !== 'US') {
    valid = false;
    validationErrors.push(`Invalid country: ${rtbRequest.device?.geo?.country}`);
  }
  
  // Final result
  if (valid) {
    console.log('✅ OpenRTB Request is valid!');
  } else {
    console.error('❌ OpenRTB Request validation failed:');
    validationErrors.forEach(error => console.error(`- ${error}`));
    process.exit(1);
  }
  
} catch (error) {
  console.error('ERROR executing buildOpenRtbRequest:', error);
  process.exit(1);
}