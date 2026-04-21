export type Subscription = {
  id: string;
  price: string;
  displayAti: string;
};

export type Participant = {
  name: string;
  surname: string;
  subscriptionSet: Subscription[];
};

export type FormData = {
  name: string;
  surname: string;
  subscriptionSet: Subscription[];
  otherPeople: Participant[];
};
