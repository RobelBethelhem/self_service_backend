import moment from "moment"

function calculatePayments(data, pricePerRoom) {
    let installmentType;
    if (data.payment_period === 'monthly') {
        installmentType = 12;
    } else if (data.payment_period === 'quarterly') {
        installmentType = 4;
    } else if (data.payment_period === 'yearly') {
        installmentType = 1;
    }

    const presentValue = pricePerRoom.selling_price;
    const totalDuration = Number(data.payment_duration) * installmentType;
    const ratePerPeriod = (Number(data.discount_rate) / 100) / installmentType;

    // Calculate the payment amount
    const payment = presentValue * (ratePerPeriod * Math.pow(1 + ratePerPeriod, totalDuration)) / (Math.pow(1 + ratePerPeriod, totalDuration) - 1);

    // Calculate the cash flow for each installment
    let remainingBalance = presentValue;
    const cashFlows = [];
    let currentDate = moment(data.repayment_started);

    for (let i = 1; i <= totalDuration; i++) {
        const interestPayment = remainingBalance * ratePerPeriod;
        const principalPayment = payment - interestPayment;
        remainingBalance -= principalPayment;

        cashFlows.push({
            installment: i,
            amount: payment.toFixed(2),
            principalPayment: principalPayment.toFixed(2),
            interestPayment: interestPayment.toFixed(2),
            remainingBalance: remainingBalance.toFixed(2),
            dueDate: currentDate.format('YYYY-MM-DD')
        });

        // Adjust the due date for the next installment
        if (data.payment_period === 'monthly') {
            currentDate.add(1, 'month');
        } else if (data.payment_period === 'quarterly') {
            currentDate.add(3, 'months');
        } else if (data.payment_period === 'yearly') {
            currentDate.add(1, 'year');
        }
    }

    return cashFlows;
}

function calculatePenalities(percPerDay, percLegal_case, percAgreement_cancel, maker, presentvaluePrime){
const penality_amount_per_day = (percPerDay/100) * presentvaluePrime;
const amount_for_agreement_cancel = (percAgreement_cancel/100) * presentvaluePrime;
const amount_for_legal_case = (percLegal_case/100) * presentvaluePrime;
const registered_By = maker;
const createdAt = Date.now();
  
return {
    penality_amount_per_day: penality_amount_per_day,
    amount_for_agreement_cancel: amount_for_agreement_cancel,
    amount_for_legal_case: amount_for_legal_case,
    registered_By: registered_By,
    createdAt: createdAt
}
}

export { calculatePayments, calculatePenalities };





