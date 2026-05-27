const admin = require('firebase-admin');
const key1 = `"-----BEGIN PRIVATE KEY-----\\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCrpwiFScV1/ZWn\\nHf2gwctmOXfXsiQ6dntB7k0i+TPgmx/Vy+16P2ejxvNF3EDnJKIJ93037+/wnlIj\\nf/Znz/MmVR+0/B7zeqaDwr+UaFvjx0AU04ugePxaQ4b288GaKpFmxsRSgtegQsR0\\n7/6KkB8O1XiIw/CEeVQAoa48Qy11ESI1nQ7MxJ+5cZ8iqpsrrBOzbg25TnTVotPx\\nP8x02L8W/35G1zcaZU5lbERxxFw/S8Ke9Osn9iTDr0nTIsw/Uk1KvLXvLpkPhXoa\\nkCD1Ll7ZY8Vzh0KfNHASrmf4WkE5FzUVN8ZOEMNupAyC0kIk2IijQaY4q+9KKSlZ\\nwiPeHXX1AgMBAAECggEASeZcpb2v9G9bWZpw0h/86KK/NK6uKDlQMX9d2Du/mOhQ\\nGWR1dhcMEJebrqz3iEveMzpIv6dd/pK6vCvgMqt1fEBTqUCONrbML5fNkSAox3TF\\n4vF8gHb19gpydalV5YCEHuJeLUPFf2qfV9TnGlKX/HPtM7xftTji8G6rK6ikTmx/\\n3bvI0/bGOzOSRI0CZzvK9OaqspwEJdtyQaeXFamxG6Ocdw3IrIlmk6ebwKJMGJlv\\nfdPOpr24/wUxCDt+Has9Rspg4jjm4nuiFPMdutZY/sqrJAWVr297xDB+I1cyLW2C\\n6MAtCE/bEbfiySXVn8EAjpiY/qqvM7r+R2Lr2GPy9QKBgQDjS2E5UIf2+RI61vhw\\nIdeKYna4Z0bHS5jzXbjejyE57mi5G5Q6C5gqrEQX6i5LK518kGBUAWkND7s3cmmW\\nS1aOnOu4EdNnouw5hy0gS45A3Ckmz41lDcr+gqbOI+hnDKofxg7+D3afgtWEjHcC\\nKbk7/LrVfZP/hEvD98cINDQ5LwKBgQDBVLOhlsVDacn6tbtXbmnvDDHeOSdmY2+T\\n3I79F7ZQxFeCz4wxhnCQlTdiz/QYN+oMCBJ+pePTWQ53GG7AxXiTAmr8GVmfV6cs\\nqfMwAcVRmKDnAIQWz4Hbk6NytTGStRuAzlQN4HgDOae2IFwT4UIMAfb9qv3TPjgJ\\nfsAKHQPyGwKBgHq8UKK/brwZYROu03bRf291ngATnK+vjccUu+hKR7ndmGUklFUH\\nv8KDRT3Ysejbg24pFCsom852yTS2rnd+9R2LdOnvjkWvP3oNGXwP8J/rgrk3aHXC\\nDfSDHom/8BX9S7xemefs97RI1P1/UCA14ZWX8leoOQvIJ5WJrcsrTWv3AoGADel2\\nc65Ry6QVMMFbFdOQM++AtykNuMR3BwDcGUJXkEBQu80LnZS7DOxv6+BjBEshwHPk\\nQNDXMCI8dD2B2sVbA9kssa9xT5ITKZehNFcsR87f5T+YQbv08EQTgvGe+5ukuwQd\\n8FGy0SiY9PYnKhcPlaWejGp9kXHsvmIsl4229vkCgYB02eIiPzo8mGhXdf450exr\\n9Ig1jbhZiOOMfK1YtG8L+6kPn32J0XEleUjHJGLHBhcOFYSVHNudgaWkVSmy6Sti\\n69hIT89LefonY4U6MicMxTwzHH60TAfi5YN8DnkfYNYdVPDee7HBDYPUdWJiN+65\\n3kh1DaIanVz0OwTZKFj9DA==\\n-----END PRIVATE KEY-----\\n"`;

let parsed = key1.replace(/^"|"$/g, '').replace(/\\n/g, '\n');
console.log('Parsed ends with newlines:', parsed.split('\n').length);
console.log('Parsed starts with:', parsed.slice(0, 30));

try {
  admin.credential.cert({
    projectId: 'test',
    clientEmail: 'test@test.com',
    privateKey: parsed
  });
  console.log('Success parsing');
} catch (e) {
  console.log('Error parsing:', e.message);
}
