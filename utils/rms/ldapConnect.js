import ldap from "ldapjs";



  function authentication(username, password) {
    return new Promise((resolve, reject) => {
      const client = ldap.createClient({
        url: 'ldap://mbdcp06.zemenbank.local:389',
        referrals: 'follow'
      });
  
      const users = [];
      let retrievedCount = 0; // Track the number of retrieved users
  
      // Incrementally retrieve users using a recursive function
      const fetchNextPage = (cookie = '') => {
        client.bind(username, password, (bindErr) => {
          if (bindErr) {
            reject(bindErr);
            return;
          }
  
          const opts = {
            filter: '(&(objectClass=person)(objectClass=organizationalPerson)(objectClass=user)(sAMAccountName=*))',
            scope: 'sub',
            attributes: ['mail', 'sAMAccountName'],
           // attributes: ['*'],
            paged: true,
            pageSize: 1000, // Adjust page size as needed
            cookie
          };
  
          client.search('dc=zemenbank,dc=local', opts, (searchErr, searchRes) => {
            if (searchErr) {
              reject(searchErr);
              return;
            }
  
            searchRes.on('searchEntry', (entry) => {
              const attributes = entry.attributes;
              const user = {};
  
              for (const attribute of attributes) {
                const attributeName = attribute.type;
                const attributeValue = attribute.values.join(', '); // If the attribute can have multiple values
  
                // Store the attribute in the user object if needed
                user[attributeName] = attributeValue;
              }
  
              if ('mail' in user) {
                users.push(user);
                retrievedCount++;
  
                if (retrievedCount === 3) {
                 // console.log("usersusersusersusersusersusersusersusersusersusersusersusersusersusersusersusers",user);
                  resolve(users); // Reached the desired count, resolve with the retrieved users
                  client.unbind(); // Unbind after completion
                  return;
                }
              }
            });
  
            searchRes.on('error', (err) => {
              console.error('error:', err.message);
              reject(err);
            });
  
            searchRes.on('end', (result) => {
              console.log('status:', result.status);
              if (result.status === ldap.SEARCH_RESULT_SIZE_LIMIT_EXCEEDED) {
                fetchNextPage(result.controls.cookie); // Fetch next page with cookie
              } else {
                resolve(users); // All users retrieved (less than 3)
                client.unbind(); // Unbind after completion
              }
            });
          });
        });
      };
  
      fetchNextPage(); // Initiate the first page fetch
    });
  }



  export {authentication};