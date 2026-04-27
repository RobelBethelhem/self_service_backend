import { Router } from "express";
import auth from "../../../../middleware/rms/auth.js";
import roleCheck from "../../../../middleware/rms/roleCheck.js";
import { Agreement } from "../../../../models/rms/Aggrement.js";
import User from "../../../../models/rms/User.js";

const router = Router();

router.post('/get_detail_aggerement', auth, roleCheck(["admin", "site_manager"]), async (req, res, next) => {
  console.log('Yoftahi Suleman', req.body)

  const getUser = await req.user;
  const id = getUser._id;
  const specific_user = await User.findOne({ _id: id });
  const user = { ...specific_user._doc };
  delete user._id;
  delete user.__v;
  delete user.password;

  var template = {
    id: '',
    name: '',
    principalPayment: '',
    interestPayment: '',
    remainingBalance: '',
    amount: '',
    accrue_left_amount: '',
    left_amount: '',
    dueDate: '', 
    unpaid_date_difference: '',
    payment: '',
    paid: '',
    status: '',
    paidDate: '',
    registered_By: '',
    Created_At: '',
    Updated_At: '',
    updated_By: '',
  }

  const dataa = await Agreement.findById(req.body.id);
 

  const installments = dataa.installments;


  const newObj = installments.map((item, index) => {
    const { __v, _id, ...rest } = item._doc;
    const hasScriptProperty = Object.values(rest).some(propValue => 
      typeof propValue === 'string' &&
      (propValue.includes('script') || propValue.includes('iframe') || propValue.includes('<') || propValue.includes('>') || propValue.includes('alert'))
    );
  
    if (!hasScriptProperty) {
      return { ...template, id: _id.toString(), ...rest };
  }
    return null;
  }).filter(Boolean);
  
  // Send response
  const sendUsers = {
    data: newObj,
    meta: { totalRowCount: dataa.length }
  };
  var sampleData = [
    {
      id: '001',
      name: 'Installment 1',
      principalPayment: '1500.00',
      interestPayment: '500.00',
      remainingBalance: '48000.00',
      amount: '2000.00',
      dueDate: '2023-09-01',
      unpaid_date_difference: '0',
      paid_amount: '2000.00',
      paid: true,
      status: 'Paid',
      paidDate: '2023-09-01',
      registered_By: 'John Doe',
      Created_At: '2023-08-15T10:30:00Z',
      Updated_At: '2023-09-01T14:45:00Z',
      updated_By: 'Jane Smith',
    },
    {
      id: '002',
      name: 'Installment 1',
      principalPayment: '1525.00',
      interestPayment: '475.00',
      remainingBalance: '46475.00',
      amount: '2000.00',
      dueDate: '2023-10-01',
      unpaid_date_difference: '5',
      paid_amount: '2000.00',
      paid: true,
      status: 'Paid Late',
      paidDate: '2023-10-06',
      registered_By: 'John Doe',
      Created_At: '2023-08-15T10:30:00Z',
      Updated_At: '2023-10-06T11:20:00Z',
      updated_By: 'Alice Johnson',
    },
    {
      id: '003',
      name: 'Installment 2',
      principalPayment: '1550.00',
      interestPayment: '450.00',
      remainingBalance: '44925.00',
      amount: '2000.00',
      dueDate: '2023-11-01',
      unpaid_date_difference: '',
      paid_amount: '1000.00',
      paid: false,
      status: 'Partially Paid',
      paidDate: '2023-11-01',
      registered_By: 'John Doe',
      Created_At: '2023-08-15T10:30:00Z',
      Updated_At: '2023-11-01T09:15:00Z',
      updated_By: 'Bob Wilson',
    },
    {
      id: '004',
      name: 'Installment 2',
      principalPayment: '1575.00',
      interestPayment: '425.00',
      remainingBalance: '43350.00',
      amount: '2000.00',
      dueDate: '2023-12-01',
      unpaid_date_difference: '15',
      paid_amount: '0.00',
      paid: false,
      status: 'Unpaid',
      paidDate: '',
      registered_By: 'John Doe',
      Created_At: '2023-08-15T10:30:00Z',
      Updated_At: '2023-12-16T16:00:00Z',
      updated_By: 'Charlie Brown',
    },
    {
      id: '005',
      name: 'Installment 2',
      principalPayment: '1600.00',
      interestPayment: '400.00',
      remainingBalance: '41750.00',
      amount: '2000.00',
      dueDate: '2024-01-01',
      unpaid_date_difference: '',
      paid_amount: '2000.00',
      paid: true,
      status: 'Paid',
      paidDate: '2023-12-28',
      registered_By: 'John Doe',
      Created_At: '2023-08-15T10:30:00Z',
      Updated_At: '2023-12-28T13:50:00Z',
      updated_By: 'Diana Evans',
    }
  ];

  const mergedArray = [...newObj, ...sampleData]

  const sendToFrontEnd = {
    error: false,
    data: mergedArray
  }


  
  res.json(sendToFrontEnd)
});



export default router;