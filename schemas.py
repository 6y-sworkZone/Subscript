from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime


class SubscriptionBase(BaseModel):
    name: str
    service_type: str
    provider: Optional[str] = None
    subscription_date: Optional[date] = None
    billing_cycle: str
    price: float
    billing_day: Optional[int] = None
    payment_method: Optional[str] = None
    auto_renewal: bool = True
    icon_url: Optional[str] = None
    notes: Optional[str] = None
    is_trial: bool = False
    trial_end_date: Optional[date] = None


class SubscriptionCreate(SubscriptionBase):
    pass


class SubscriptionUpdate(SubscriptionBase):
    pass


class Subscription(SubscriptionBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class BillingRecordBase(BaseModel):
    subscription_id: int
    billing_date: date
    amount: float
    is_actual: bool = True
    status: str = "success"
    failure_reason: Optional[str] = None


class BillingRecordCreate(BillingRecordBase):
    pass


class BillingRecord(BillingRecordBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class UsageRecordBase(BaseModel):
    subscription_id: int
    usage_date: date
    duration_minutes: Optional[int] = None
    usage_count: int = 1
    notes: Optional[str] = None


class UsageRecordCreate(UsageRecordBase):
    pass


class UsageRecord(UsageRecordBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class PriceHistoryBase(BaseModel):
    subscription_id: int
    old_price: Optional[float] = None
    new_price: float
    change_date: date
    notes: Optional[str] = None


class PriceHistoryCreate(PriceHistoryBase):
    pass


class PriceHistory(PriceHistoryBase):
    id: int

    class Config:
        from_attributes = True


class SharedMemberBase(BaseModel):
    subscription_id: int
    name: str
    share_amount: float
    payment_status: str = "pending"
    last_payment_date: Optional[date] = None
    notes: Optional[str] = None


class SharedMemberCreate(SharedMemberBase):
    pass


class SharedMember(SharedMemberBase):
    id: int

    class Config:
        from_attributes = True


class CancellationGuideBase(BaseModel):
    subscription_id: int
    steps: str
    alternative_services: Optional[str] = None
    notes: Optional[str] = None


class CancellationGuideCreate(CancellationGuideBase):
    pass


class CancellationGuide(CancellationGuideBase):
    id: int

    class Config:
        from_attributes = True


class ReminderBase(BaseModel):
    subscription_id: Optional[int] = None
    reminder_type: str
    reminder_date: date
    message: Optional[str] = None
    is_read: bool = False


class ReminderCreate(ReminderBase):
    pass


class Reminder(ReminderBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class SecureCredentialBase(BaseModel):
    subscription_id: int
    encrypted_username: Optional[str] = None
    encrypted_password_hint: Optional[str] = None
    iv: Optional[str] = None


class SecureCredentialCreate(SecureCredentialBase):
    pass


class SecureCredential(SecureCredentialBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class BudgetBase(BaseModel):
    year: int
    amount: float
    category: str = "all"


class BudgetCreate(BudgetBase):
    pass


class Budget(BudgetBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


class ArticleBase(BaseModel):
    title: str
    category: Optional[str] = None
    content: str
    is_published: bool = True


class ArticleCreate(ArticleBase):
    pass


class Article(ArticleBase):
    id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SubscriptionDetail(Subscription):
    billing_records: List[BillingRecord] = []
    usage_records: List[UsageRecord] = []
    price_history: List[PriceHistory] = []
    shared_members: List[SharedMember] = []
    cancellation_guide: Optional[CancellationGuide] = None
    usage_stats: Optional[dict] = None
    cost_per_use: Optional[float] = None
    days_until_renewal: Optional[int] = None
