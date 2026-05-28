from sqlalchemy import Column, Integer, String, Float, Date, Boolean, Text, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    service_type = Column(String(50), nullable=False)
    provider = Column(String(100))
    subscription_date = Column(Date)
    billing_cycle = Column(String(20), nullable=False)
    price = Column(Float, nullable=False)
    billing_day = Column(Integer)
    payment_method = Column(String(50))
    auto_renewal = Column(Boolean, default=True)
    icon_url = Column(String(500))
    notes = Column(Text)
    is_trial = Column(Boolean, default=False)
    trial_end_date = Column(Date)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    billing_records = relationship("BillingRecord", back_populates="subscription", cascade="all, delete-orphan")
    usage_records = relationship("UsageRecord", back_populates="subscription", cascade="all, delete-orphan")
    price_history = relationship("PriceHistory", back_populates="subscription", cascade="all, delete-orphan")
    shared_members = relationship("SharedMember", back_populates="subscription", cascade="all, delete-orphan")
    cancellation_guide = relationship("CancellationGuide", back_populates="subscription", uselist=False, cascade="all, delete-orphan")


class BillingRecord(Base):
    __tablename__ = "billing_records"

    id = Column(Integer, primary_key=True, index=True)
    subscription_id = Column(Integer, ForeignKey("subscriptions.id"), nullable=False)
    billing_date = Column(Date, nullable=False)
    amount = Column(Float, nullable=False)
    is_actual = Column(Boolean, default=True)
    status = Column(String(20), default="success")
    failure_reason = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    subscription = relationship("Subscription", back_populates="billing_records")


class UsageRecord(Base):
    __tablename__ = "usage_records"

    id = Column(Integer, primary_key=True, index=True)
    subscription_id = Column(Integer, ForeignKey("subscriptions.id"), nullable=False)
    usage_date = Column(Date, nullable=False)
    duration_minutes = Column(Integer)
    usage_count = Column(Integer, default=1)
    notes = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    subscription = relationship("Subscription", back_populates="usage_records")


class PriceHistory(Base):
    __tablename__ = "price_history"

    id = Column(Integer, primary_key=True, index=True)
    subscription_id = Column(Integer, ForeignKey("subscriptions.id"), nullable=False)
    old_price = Column(Float)
    new_price = Column(Float, nullable=False)
    change_date = Column(Date, nullable=False)
    notes = Column(Text)

    subscription = relationship("Subscription", back_populates="price_history")


class SharedMember(Base):
    __tablename__ = "shared_members"

    id = Column(Integer, primary_key=True, index=True)
    subscription_id = Column(Integer, ForeignKey("subscriptions.id"), nullable=False)
    name = Column(String(100), nullable=False)
    share_amount = Column(Float, nullable=False)
    payment_status = Column(String(20), default="pending")
    last_payment_date = Column(Date)
    notes = Column(Text)

    subscription = relationship("Subscription", back_populates="shared_members")


class CancellationGuide(Base):
    __tablename__ = "cancellation_guides"

    id = Column(Integer, primary_key=True, index=True)
    subscription_id = Column(Integer, ForeignKey("subscriptions.id"), nullable=False, unique=True)
    steps = Column(Text, nullable=False)
    alternative_services = Column(Text)
    notes = Column(Text)

    subscription = relationship("Subscription", back_populates="cancellation_guide")


class Reminder(Base):
    __tablename__ = "reminders"

    id = Column(Integer, primary_key=True, index=True)
    subscription_id = Column(Integer, ForeignKey("subscriptions.id"))
    reminder_type = Column(String(50), nullable=False)
    reminder_date = Column(Date, nullable=False)
    message = Column(String(500))
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class SecureCredential(Base):
    __tablename__ = "secure_credentials"

    id = Column(Integer, primary_key=True, index=True)
    subscription_id = Column(Integer, ForeignKey("subscriptions.id"), unique=True)
    encrypted_username = Column(String(500))
    encrypted_password_hint = Column(String(500))
    iv = Column(String(100))
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class BillScreenshot(Base):
    __tablename__ = "bill_screenshots"

    id = Column(Integer, primary_key=True, index=True)
    subscription_id = Column(Integer, ForeignKey("subscriptions.id"))
    file_path = Column(String(500), nullable=False)
    billing_month = Column(String(7))
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())


class Article(Base):
    __tablename__ = "articles"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    category = Column(String(50))
    content = Column(Text, nullable=False)
    is_published = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class Budget(Base):
    __tablename__ = "budgets"

    id = Column(Integer, primary_key=True, index=True)
    year = Column(Integer, nullable=False)
    amount = Column(Float, nullable=False)
    category = Column(String(50), default="all")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
