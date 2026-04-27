const roleCheck = (roles) => {
    return (req, res, next) => {
      const rolesLength = roles.length;
      let matchFound = false; // Flag to track if a match is found
  
      for (let i = 0; i < rolesLength; i++) {
        const cus_roles = [roles[i]];
  
        if (req.user.roles.includes(...cus_roles)) {
          matchFound = true;
          break; // Exit the loop if a match is found
        }
      }
  
      if (matchFound) {
        next(); // Call next middleware if a match is found
      } else {
        res.status(403).json({ error: true, message: "You are not authorized" });
      }
    };
  };
  
  export default roleCheck;